"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { botVersions, bots } from "@/db/schema";
import { MODEL_PROBLEM_TEXT } from "@/lib/ai/model-meta";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { checkRollback, configModelProblems, getMainBot, PublishError, publishCorrections, publishDraft, rollbackTo } from "@/lib/bot";
import { encrypt, randomToken } from "@/lib/crypto";
import { bool, done, fail, str, strStrict } from "@/lib/form";
import { VERSION_NOTE_MAX } from "@/lib/form-limits";

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
