"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/db";
import { providers, type ProviderKind, type ProviderModel } from "@/db/schema";
import { reindexAll } from "@/lib/ai/ingest";
import { PROVIDER_KINDS, testModel } from "@/lib/ai/providers";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, getPublishedVersion } from "@/lib/bot";
import { MODES } from "@/lib/bot-config";
import { encrypt } from "@/lib/crypto";
import { done, fail, formToObject, str } from "@/lib/form";
import { getSetting, setSetting } from "@/lib/settings";

const BACK = "/admin/ayarlar/modeller";

export async function createProvider(fd: FormData) {
  const admin = await requireAdmin("models");
  const kind = str(fd, "kind") as ProviderKind;
  if (!(kind in PROVIDER_KINDS)) fail(BACK, "Sağlayıcı türünü seçin.");
  const meta = PROVIDER_KINDS[kind];
  const apiKey = str(fd, "apiKey", 500);
  const baseUrl = str(fd, "baseUrl", 500);
  if (!apiKey) fail(BACK, "API anahtarı gerekli.");
  if (meta.needsBaseUrl && !baseUrl) fail(BACK, "Bu sağlayıcı türü için temel adres (base URL) gerekli.");
  const [p] = await db
    .insert(providers)
    .values({
      kind,
      name: str(fd, "name", 80) || meta.label,
      apiKeyEnc: encrypt(apiKey),
      baseUrl: baseUrl || null,
      models: meta.presetModels,
      embeddingModels: meta.presetEmbeddings,
    })
    .returning();
  await audit(admin, "provider.create", p.id, { kind, name: p.name });
  revalidatePath(BACK);
  done(`${BACK}#p-${p.id}`, `${p.name} eklendi. Modelleri ve fiyatlarını kontrol edin.`);
}

export async function updateProvider(fd: FormData) {
  const admin = await requireAdmin("models");
  const id = str(fd, "id");
  const [p] = await db.select().from(providers).where(eq(providers.id, id));
  if (!p) fail(BACK, "Sağlayıcı bulunamadı.");

  const rows = formToObject(fd, "models").valueOf() as Record<string, Record<string, string>>;
  const models: ProviderModel[] = Object.values(rows)
    .filter((r) => r && r.id && r.remove !== "on")
    .map((r) => ({
      id: r.id.trim(),
      label: r.label?.trim() || r.id.trim(),
      vision: r.vision === "on",
      tools: r.tools === "on",
      inputPer1M: Math.max(0, Number(String(r.inputPer1M ?? "0").replace(",", ".")) || 0),
      outputPer1M: Math.max(0, Number(String(r.outputPer1M ?? "0").replace(",", ".")) || 0),
    }));
  const embeddingModels = str(fd, "embeddingModels", 1000)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const apiKey = str(fd, "apiKey", 500);
  await db
    .update(providers)
    .set({
      name: str(fd, "name", 80) || p!.name,
      baseUrl: str(fd, "baseUrl", 500) || null,
      models,
      embeddingModels,
      ...(apiKey ? { apiKeyEnc: encrypt(apiKey) } : {}),
    })
    .where(eq(providers.id, id));
  await audit(admin, "provider.update", id, { models: models.length, keyChanged: Boolean(apiKey) });
  revalidatePath(BACK);
  done(`${BACK}#p-${id}`, "Kaydedildi.");
}

export async function deleteProvider(fd: FormData) {
  const admin = await requireAdmin("models");
  const id = str(fd, "id");
  const bot = await getMainBot();
  const published = await getPublishedVersion(bot);
  const inUse = MODES.filter((m) => bot.draftConfig.modes[m].providerId === id || published?.config.modes[m].providerId === id);
  if (inUse.length) fail(`${BACK}#p-${id}`, `Bu sağlayıcı ${inUse.map((m) => bot.draftConfig.modes[m].label).join(", ")} tarafından kullanılıyor. Önce o modlara başka model seçip yayınlayın.`);
  await db.delete(providers).where(eq(providers.id, id));
  const emb = await getSetting("embedding");
  if (emb.providerId === id) await setSetting("embedding", { providerId: null, model: null });
  await audit(admin, "provider.delete", id);
  revalidatePath(BACK);
  done(BACK, "Sağlayıcı silindi.");
}

export async function runModelTest(fd: FormData) {
  await requireAdmin("models");
  const id = str(fd, "id");
  const model = str(fd, "model");
  const r = await testModel(id, model);
  if (r.ok) done(`${BACK}#p-${id}`, `${model} çalışıyor (${r.ms} ms). Cevap: "${r.message}"`);
  fail(`${BACK}#p-${id}`, `${model} bağlantısı başarısız: ${r.message.slice(0, 300)}`);
}

export async function saveEmbedding(fd: FormData) {
  const admin = await requireAdmin("models");
  const [providerId, model] = str(fd, "embedding").split("::");
  const prev = await getSetting("embedding");
  const next = { providerId: providerId || null, model: model || null };
  await setSetting("embedding", next);
  const changed = prev.providerId !== next.providerId || prev.model !== next.model;
  if (changed) {
    const bot = await getMainBot();
    after(() => reindexAll(bot.id));
    await audit(admin, "embedding.update", null, next);
  }
  revalidatePath(BACK);
  done(
    `${BACK}#embedding`,
    changed ? (next.model ? "Embedding modeli değişti. Tüm kaynaklar arka planda yeniden işleniyor." : "Vektör araması kapatıldı; yalnızca tam metin araması kullanılacak.") : "Değişiklik yok.",
  );
}

export async function reindexNow() {
  const admin = await requireAdmin("models");
  const bot = await getMainBot();
  after(() => reindexAll(bot.id));
  await audit(admin, "kb.reindex");
  done(`${BACK}#embedding`, "Yeniden indeksleme başladı. İlerlemeyi Bilgi tabanı sayfasından izleyebilirsiniz.");
}
