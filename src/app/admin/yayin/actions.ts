"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { bots } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, publishDraft, rollbackTo } from "@/lib/bot";
import { MODES } from "@/lib/bot-config";
import { encrypt, randomToken } from "@/lib/crypto";
import { bool, done, fail, str } from "@/lib/form";

const BACK = "/admin/yayin";

export async function publish(fd: FormData) {
  const admin = await requireAdmin("publish");
  const bot = await getMainBot();
  const cfg = bot.draftConfig;
  const missing = MODES.filter((m) => cfg.modes[m].enabled && !(cfg.modes[m].providerId && cfg.modes[m].model));
  if (missing.length && !bool(fd, "force")) {
    fail(BACK, `${missing.map((m) => cfg.modes[m].label).join(", ")} için model seçilmemiş. Bu modlar yayında hata verir.`);
  }
  const v = await publishDraft(bot, admin.email, str(fd, "note", 300) || null);
  await audit(admin, "bot.publish", `v${v.number}`, { kbSources: v.kbSourceIds.length });
  revalidatePath("/admin", "layout");
  done(BACK, `v${v.number} yayında. Uygulamadaki kullanıcılar bir sonraki mesajlarında yeni ayarları kullanır.`);
}

export async function rollback(fd: FormData) {
  const admin = await requireAdmin("publish");
  const bot = await getMainBot();
  const v = await rollbackTo(bot, str(fd, "versionId"));
  if (!v) fail(BACK, "Sürüm bulunamadı.");
  await audit(admin, "bot.rollback", `v${v!.number}`);
  revalidatePath("/admin", "layout");
  done(BACK, `v${v!.number} yeniden yayında. Taslağınız değişmedi.`);
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
