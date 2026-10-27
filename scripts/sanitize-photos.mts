/*
 * Eski kullanıcı fotoğraflarından EXIF/GPS ve diğer meta veriyi temizler.
 *   npm run photos:sanitize                 (kuru çalıştırma, hiçbir şey yazılmaz)
 *   npm run photos:sanitize -- --apply      (dosyaları yerinde, atomik olarak değiştirir)
 *   --limit N        en fazla N dosya işler
 *   --max-pixels N   piksel üst sınırı (varsayılan IMAGE_LIMITS.maxPixels)
 * Biçim anahtar uzantısından değil içerikten anlaşılır (.bin/.pdf/.svg anahtarlı JPEG'ler de temizlenir). Temizlenen içerik
 * AYNI anahtara yazılır: DB satırı (size, media_type) güncellenir; KVKK silme yolları, imzalı bağlantılar ve admin sayfaları
 * anahtara bağlı olduğu için eski anahtarda ham (GPS'li) bir kopya yetim kalmaz.
 * Tekrar çalıştırmak güvenlidir: meta verisi olmayan dosya atlanır; dosya temizlenmiş ama satır eski kalmışsa satır düzeltilir.
 * Hiçbir şey silinmez.
 * Çıktıya yalnızca kimlik, anahtar ve sonuç yazılır; koordinat ya da cihaz bilgisi yazılmaz.
 */
import { and, eq, inArray, like, not, sql } from "drizzle-orm";
import { db, sqlClient } from "../src/db/index";
import { attachments } from "../src/db/schema";
import { IMAGE_LIMITS, inspectMetadata } from "../src/lib/image-sanitize";
import { audit } from "../src/lib/audit";
import { runImageWork } from "../src/lib/image-limiter";
import { processPhoto, rowNeedsUpdate } from "../src/lib/photo-migrate-core";
import { storage } from "../src/lib/storage";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const apply = flag("--apply");
const limit = value("--limit");
const maxPixels = value("--max-pixels") ?? IMAGE_LIMITS.maxPixels;
if ((limit !== undefined && !(limit > 0)) || !(maxPixels > 0)) {
  console.error("--limit ve --max-pixels pozitif sayı olmalı.");
  process.exit(1);
}

const PAGE = 100;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
// heic: eski HEIC (temizlenemez). wrongExt: anahtar uzantısı içerikle uyuşmuyor (başka sonuçlarla birlikte sayılır).
// failed: okunamayan/bozuk/tanınmayan içerik. dbFixed: dosya temiz ama satırın size/media_type değeri eskiydi.
const stats = { scanned: 0, cleaned: 0, alreadyClean: 0, heic: 0, failed: 0, tooLarge: 0, missing: 0, vanished: 0, wrongExt: 0, dbFixed: 0, hadGps: 0 };
const failedIds: string[] = [];

function report(id: string, key: string, outcome: string, hadGps = false, beforeBytes = 0, afterBytes = 0, extra: Record<string, boolean> = {}) {
  console.log(JSON.stringify({ id, key, outcome, hadGps, beforeBytes, afterBytes, ...extra }));
}

let cursor: { ts: string; id: string } | null = null;
scan: for (;;) {
  const rows: { id: string; storageKey: string; mediaType: string; size: number; ts: string }[] = await db
    .select({ id: attachments.id, storageKey: attachments.storageKey, mediaType: attachments.mediaType, size: attachments.size, ts: sql<string>`${attachments.createdAt}::text` })
    .from(attachments)
    .where(
      and(
        inArray(attachments.mediaType, MEDIA_TYPES),
        like(attachments.storageKey, "photos/%"),
        not(like(attachments.storageKey, "photos/demo/%")),
        cursor ? sql`(${attachments.createdAt}, ${attachments.id}) > (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : undefined,
      ),
    )
    .orderBy(attachments.createdAt, attachments.id)
    .limit(PAGE);
  if (!rows.length) break;

  for (const row of rows) {
    cursor = { ts: row.ts, id: row.id };
    if (limit !== undefined && stats.scanned >= limit) break scan;
    stats.scanned++;
    try {
      const file = await storage.get(row.storageKey);
      if (!file) {
        stats.missing++;
        report(row.id, row.storageKey, "missing");
        continue;
      }
      const keyExt = row.storageKey.split(".").pop() ?? "";
      // Sunucuyla aynı paylaşılan görsel işleme sınırı (betik tek tek ilerler; sınır yalnızca aynı süreçteki işleri sayar).
      const r = await runImageWork(() => processPhoto(file.data, { keyExt, maxPixels }));
      if (r.hadGps) stats.hadGps++;
      if (r.extMismatch) stats.wrongExt++;
      // Dosya temiz ama satır eski (önceki çalıştırmada put başarılı, db.update başarısız olmuş olabilir): satırı düzelt.
      const rowStale = r.outcome === "already_clean" && rowNeedsUpdate(row, r);

      if (r.outcome === "cleaned" && apply) {
        // KVKK yarışı: satır FOR UPDATE ile kilitlenir; KVKK silme yolları satırı silerken bu kilidi bekler. Satır ya da dosya
        // kilit altında artık yoksa (KVKK dosyayı satırdan ÖNCE siler) yazılmaz, böylece silinmiş dosya yeniden oluşmaz.
        const outcome = await db.transaction(async (tx) => {
          const [now] = await tx.select({ key: attachments.storageKey }).from(attachments).where(eq(attachments.id, row.id)).for("update");
          if (!now || now.key !== row.storageKey) return "vanished" as const;
          if (!(await storage.get(row.storageKey))) return "vanished" as const;
          await storage.put(row.storageKey, r.data!, r.mediaType!);
          const back = await storage.get(row.storageKey);
          if (!back || !(await runImageWork(() => inspectMetadata(back.data))).clean) throw new Error("doğrulama başarısız");
          await tx.update(attachments).set({ size: r.afterBytes, mediaType: r.mediaType! }).where(eq(attachments.id, row.id));
          return "done" as const;
        });
        if (outcome === "vanished") {
          stats.vanished++;
          report(row.id, row.storageKey, "vanished", r.hadGps, r.beforeBytes);
          continue;
        }
      } else if (rowStale) {
        stats.dbFixed++;
        if (apply) await db.update(attachments).set({ size: r.afterBytes, mediaType: r.mediaType! }).where(eq(attachments.id, row.id));
      }

      const counter = { cleaned: "cleaned", already_clean: "alreadyClean", unsupported: "heic", too_large: "tooLarge", failed: "failed" } as const;
      stats[counter[r.outcome]]++;
      if (r.outcome === "failed") failedIds.push(row.id);
      report(row.id, row.storageKey, r.reason ? `${r.outcome}:${r.reason}` : r.outcome, r.hadGps, r.beforeBytes, r.afterBytes, { wrongExt: r.extMismatch, dbFixed: rowStale });
    } catch (err) {
      stats.failed++;
      failedIds.push(row.id);
      report(row.id, row.storageKey, "failed");
      console.error(`hata: ${row.id} ${err instanceof Error ? err.name : "bilinmiyor"}`);
    }
  }
  if (rows.length < PAGE) break;
}

const mode = apply ? "apply" : "dry-run";
console.log(`\nMod: ${mode}`);
console.table(stats);
await audit(null, "photo.sanitize", null, { mode, ...stats, failedIds: failedIds.slice(0, 200) });
await sqlClient.end();
process.exit(stats.failed > 0 ? 2 : 0);
