"use server";

import { and, count, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { botVersions, bots, bridgeKeys } from "@/db/schema";
import { MODEL_PROBLEM_TEXT } from "@/lib/ai/model-meta";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { checkRollback, configModelProblems, getMainBot, PublishError, publishCorrections, publishDraft, rollbackTo } from "@/lib/bot";
import { encrypt, randomToken } from "@/lib/crypto";
import { bool, done, fail, str, strStrict } from "@/lib/form";
import { VERSION_NOTE_MAX } from "@/lib/form-limits";
import { invalidateBridgeKeyCache } from "@/lib/bridge/auth";
import { bridgeKeyHint, generateBridgeKey, hashBridgeKey, MAX_ACTIVE_KEYS } from "@/lib/bridge/keys-core";

const BACK = "/admin/yayin";

export async function publish(fd: FormData) {
  const admin = await requireAdmin("publish");
  const bot = await getMainBot();
  const force = bool(fd, "force");
  // Embedding modeli değişmişken işlenmeyi bekleyen kaynak varsa ayrı bir onay gerekir.
  const forceIndex = bool(fd, "forceIndex");
  const report = { pendingIndex: 0 };
  // Model doğrulaması publishDraft içinde, kilit altında okunan config üzerinde yapılır.
  let v: Awaited<ReturnType<typeof publishDraft>>;
  try {
    v = await publishDraft(bot, admin.email, str(fd, "note", 300) || null, { requireModels: !force, requireIndexed: !forceIndex, report });
  } catch (e) {
    if (e instanceof PublishError) fail(BACK, e.message);
    throw e;
  }
  // Onayla geçilen sorunlar, yayınlanan (dondurulmuş) config'ten çıkarılır.
  const problems = force ? (await configModelProblems(v.config, { includeUnset: true })).map((p) => `${p.label}: ${MODEL_PROBLEM_TEXT[p.reason]}`) : [];
  await audit(admin, "bot.publish", `v${v.number}`, { kbSources: v.kbSourceIds.length, force, problems, forceIndex, pendingIndex: report.pendingIndex });
  revalidatePath("/admin", "layout");
  done(BACK, `v${v.number} yayında. Uygulamadaki kullanıcılar bir sonraki mesajlarında yeni ayarları kullanır.`);
}

/** Yalnızca bekleyen düzeltme/SSS kaynaklarını yayına alır; kişilik/kural taslağı yayınlanmaz. */
export async function publishPendingCorrections(fd: FormData) {
  const admin = await requireAdmin("publish");
  const back = str(fd, "back") === "duzeltmeler" ? "/admin/egitim/duzeltmeler" : BACK;
  const bot = await getMainBot();
  let result: Awaited<ReturnType<typeof publishCorrections>>;
  try {
    result = await publishCorrections(bot, admin.email);
  } catch (e) {
    if (e instanceof PublishError) fail(back, e.message);
    throw e;
  }
  const { version: v, added } = result;
  await audit(admin, "bot.publish", `v${v.number}`, { kbSources: v.kbSourceIds.length, onlyCorrections: added });
  revalidatePath("/admin", "layout");
  done(back, `v${v.number} yayında: ${added} düzeltme/SSS canlıya alındı. Kişilik ve kural taslağınız yayınlanmadı.`);
}

export async function rollback(fd: FormData) {
  const admin = await requireAdmin("publish");
  const bot = await getMainBot();
  const versionId = str(fd, "versionId");
  const check = await checkRollback(bot, versionId);
  if (!check) fail(BACK, "Sürüm bulunamadı.");
  if (check!.problems.length && !bool(fd, "force")) {
    // Sayfa, bu sürüm için "yine de geri al" onayını gösterir.
    fail(`${BACK}?zorla=${check!.version.id}`, `${check!.problems.join("; ")}. Geri alırsanız bu modlar hata verir.`);
  }
  const v = await rollbackTo(bot, versionId);
  if (!v) fail(BACK, "Sürüm bulunamadı.");
  await audit(admin, "bot.rollback", `v${v!.number}`, { force: bool(fd, "force"), problems: check!.problems });
  revalidatePath("/admin", "layout");
  done(BACK, `v${v!.number} yeniden yayında. Taslağınız değişmedi.`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Yalnızca sürüm notunu değiştirir (config ve kaynaklar dondurulmuştur); eski ve yeni not audit kaydına yazılır. */
export async function saveVersionNote(fd: FormData) {
  const admin = await requireAdmin("publish");
  const bot = await getMainBot();
  const versionId = str(fd, "versionId");
  if (!UUID.test(versionId)) fail(BACK, "Sürüm bulunamadı.");
  const back = `${BACK}/${versionId}`;
  const note = strStrict(fd, "note", VERSION_NOTE_MAX, "Sürüm notu", back) || null;
  const [current] = await db.select({ number: botVersions.number, note: botVersions.note }).from(botVersions).where(and(eq(botVersions.id, versionId), eq(botVersions.botId, bot.id)));
  if (!current) fail(BACK, "Sürüm bulunamadı.");
  if ((current!.note ?? null) === note) done(back, "Not zaten bu şekilde.");
  await db.update(botVersions).set({ note }).where(and(eq(botVersions.id, versionId), eq(botVersions.botId, bot.id)));
  await audit(admin, "bot.version_note", `v${current!.number}`, { versionId, from: current!.note, to: note });
  revalidatePath("/admin/yayin");
  done(back, `v${current!.number} notu kaydedildi.`);
}

export async function saveAccess(fd: FormData) {
  const admin = await requireAdmin("publish");
  const bot = await getMainBot();
  const allowAnonymous = bool(fd, "allowAnonymous");
  await db.update(bots).set({ allowAnonymous, updatedAt: new Date() }).where(eq(bots.id, bot.id));
  await audit(admin, "bot.embed", null, { allowAnonymous });
  done(`${BACK}#gomme`, allowAnonymous ? "Kimliksiz (anonim) erişim açık." : "Artık yalnızca imzalı kullanıcı token'ı ile erişilebilir.");
}

export async function regenerateSecret() {
  const admin = await requireAdmin("users");
  const bot = await getMainBot();
  await db.update(bots).set({ tokenSecretEnc: encrypt(randomToken(32)), updatedAt: new Date() }).where(eq(bots.id, bot.id));
  await audit(admin, "bot.token_secret");
  done(`${BACK}?anahtar=goster#gomme`, "Yeni anahtar oluşturuldu. Uygulama backend'inize girin; eski anahtarla imzalanan token'lar artık geçersiz.");
}

/** Anahtar yalnızca `ok: true` dönüşünde bulunur; URL'ye, flash mesajına ya da log'a girmez. */
export type BridgeKeyState = { ok: true; key: string } | { ok: false; error: string } | null;

const BRIDGE_KEY_NAME_MAX = 60;

/** Mobil backend köprüsü için sunucu anahtarı üretir. En çok `MAX_ACTIVE_KEYS` etkin anahtar (rotasyon için ikincisi). */
export async function createBridgeKey(_prev: BridgeKeyState, fd: FormData): Promise<BridgeKeyState> {
  const admin = await requireAdmin("users");
  const name = str(fd, "name", 200);
  if (!name || name.length > BRIDGE_KEY_NAME_MAX) return { ok: false, error: `Ad 1-${BRIDGE_KEY_NAME_MAX} karakter olmalı.` };
  const bot = await getMainBot();
  const created = await db.transaction(async (tx) => {
    // Eşzamanlı iki oluşturma sıraya girsin; etkin anahtar sayısı kilit altında sayılır.
    await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, bot.id)).for("update");
    const [{ n }] = await tx.select({ n: count() }).from(bridgeKeys).where(and(eq(bridgeKeys.botId, bot.id), isNull(bridgeKeys.revokedAt)));
    if (n >= MAX_ACTIVE_KEYS) return null;
    const key = generateBridgeKey();
    const [row] = await tx
      .insert(bridgeKeys)
      .values({ botId: bot.id, name, keyHash: hashBridgeKey(key), hint: bridgeKeyHint(key), createdBy: admin.email })
      .returning({ id: bridgeKeys.id, hint: bridgeKeys.hint });
    return { key, id: row.id, hint: row.hint };
  });
  if (!created) return { ok: false, error: `En çok ${MAX_ACTIVE_KEYS} etkin anahtar olabilir. Önce birini iptal edin.` };
  await audit(admin, "bridge.key_create", name, { keyId: created.id, hint: created.hint });
  invalidateBridgeKeyCache();
  revalidatePath(BACK);
  return { ok: true, key: created.key };
}

/** Anahtarı iptal eder; satır silinmez (denetim izi). İptal en geç önbellek süresi (30 sn) içinde etkinleşir. */
export async function revokeBridgeKey(fd: FormData) {
  const admin = await requireAdmin("users");
  const bot = await getMainBot();
  const keyId = str(fd, "keyId");
  if (!UUID.test(keyId)) fail(BACK, "Anahtar bulunamadı.");
  const [row] = await db
    .update(bridgeKeys)
    .set({ revokedAt: new Date(), revokedBy: admin.email })
    .where(and(eq(bridgeKeys.id, keyId), eq(bridgeKeys.botId, bot.id), isNull(bridgeKeys.revokedAt)))
    .returning({ name: bridgeKeys.name, hint: bridgeKeys.hint });
  if (!row) fail(BACK, "Anahtar bulunamadı ya da zaten iptal edilmiş.");
  await audit(admin, "bridge.key_revoke", row!.name, { keyId, hint: row!.hint });
  invalidateBridgeKeyCache();
  revalidatePath(BACK);
  done(BACK, "Köprü anahtarı iptal edildi. Birkaç saniye içinde geçersiz olur.");
}
