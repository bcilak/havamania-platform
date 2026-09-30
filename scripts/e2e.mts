/*
 * Uçtan uca sohbet testi için ortamı hazırlar ve geri alır.
 *   npm run e2e -- setup      botu sahte modele ve sahte veri API'sine bağlar, yayınlar
 *   npm run e2e -- teardown   her şeyi setup öncesindeki anlık görüntüye döndürür
 * Anlık görüntü storage/.e2e-snapshot.json dosyasında tutulur.
 */
import fs from "node:fs";
import { and, eq, gte, inArray, like } from "drizzle-orm";
import { db, sqlClient } from "../src/db/index";
import { appUsers, botVersions, bots, conversations, providers, settings } from "../src/db/schema";
import { publishDraft } from "../src/lib/bot";
import { MODES, normalizeBotConfig } from "../src/lib/bot-config";
import { encrypt } from "../src/lib/crypto";

const SNAP = "storage/.e2e-snapshot.json";
const cmd = process.argv[2];
const [bot] = await db.select().from(bots).limit(1);

if (cmd === "setup") {
  if (fs.existsSync(SNAP)) throw new Error("Önceki test geri alınmamış. Önce: npm run e2e -- teardown");
  const [integration] = await db.select().from(settings).where(eq(settings.key, "integration"));
  fs.mkdirSync("storage", { recursive: true });
  fs.writeFileSync(
    SNAP,
    JSON.stringify({ startedAt: new Date().toISOString(), draftConfig: bot.draftConfig, publishedVersionId: bot.publishedVersionId, allowAnonymous: bot.allowAnonymous, integration: integration?.value ?? null }),
  );
  const [p] = await db
    .insert(providers)
    .values({
      kind: "openai_compatible",
      name: "E2E sahte model",
      apiKeyEnc: encrypt("mock"),
      baseUrl: "http://localhost:3199/v1",
      models: [{ id: "mock-1", label: "Sahte model", vision: true, tools: true, inputPer1M: 1, outputPer1M: 5 }],
    })
    .returning();
  const cfg = normalizeBotConfig(bot.draftConfig);
  for (const m of MODES) cfg.modes[m] = { ...cfg.modes[m], providerId: p.id, model: "mock-1" };
  await db.update(bots).set({ draftConfig: cfg }).where(eq(bots.id, bot.id));
  const v = await publishDraft({ ...bot, draftConfig: cfg }, "e2e", "E2E testi");
  const prevIntegration = (integration?.value ?? {}) as Record<string, unknown>;
  await db
    .insert(settings)
    .values({ key: "integration", value: { ...prevIntegration, baseUrl: "http://localhost:3199", timeoutMs: 5000 } })
    .onConflictDoUpdate({ target: settings.key, set: { value: { ...prevIntegration, baseUrl: "http://localhost:3199", timeoutMs: 5000 } } });
  console.log(`Hazır: sahte model + sahte veri API bağlandı, v${v.number} yayında. Bot anahtarı: ${bot.publicKey}`);
} else if (cmd === "teardown") {
  if (!fs.existsSync(SNAP)) throw new Error("Anlık görüntü yok; geri alınacak bir şey bulunamadı.");
  const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  await db.update(bots).set({ draftConfig: snap.draftConfig, publishedVersionId: snap.publishedVersionId, allowAnonymous: snap.allowAnonymous }).where(eq(bots.id, bot.id));
  const extra = await db.select({ id: botVersions.id }).from(botVersions).where(eq(botVersions.publishedBy, "e2e"));
  if (extra.length) await db.delete(botVersions).where(inArray(botVersions.id, extra.map((x) => x.id)));
  await db.delete(providers).where(eq(providers.name, "E2E sahte model"));
  if (snap.integration) await db.update(settings).set({ value: snap.integration }).where(eq(settings.key, "integration"));
  else await db.delete(settings).where(eq(settings.key, "integration"));
  const users = await db.select({ id: appUsers.id }).from(appUsers).where(like(appUsers.deviceId, "e2e-%"));
  if (users.length) {
    await db.delete(conversations).where(inArray(conversations.appUserId, users.map((u) => u.id)));
    await db.delete(appUsers).where(inArray(appUsers.id, users.map((u) => u.id)));
  }
  // Yalnızca test sırasında açılan test alanı konuşmaları; öncekilere dokunulmaz.
  await db.delete(conversations).where(and(eq(conversations.platform, "playground"), gte(conversations.startedAt, new Date(snap.startedAt))));
  fs.rmSync(SNAP);
  console.log(`Geri alındı: ${extra.length} test sürümü, sahte sağlayıcı ve ${users.length} test kullanıcısı silindi.`);
} else {
  console.log("Kullanım: npm run e2e -- setup | teardown");
}
await sqlClient.end();
