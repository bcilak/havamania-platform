import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type EmbeddingModel, type LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { providers, type ProviderKind, type ProviderModel } from "@/db/schema";
import { decryptOrNull } from "@/lib/crypto";
import { getSetting } from "@/lib/settings";

export type ProviderRow = typeof providers.$inferSelect;

const claude = (id: string, label: string): ProviderModel => ({ id, label, vision: true, tools: true, inputPer1M: 0, outputPer1M: 0 });

export const PROVIDER_KINDS: Record<
  ProviderKind,
  { label: string; keyHint: string; needsBaseUrl: boolean; embeddings: boolean; presetModels: ProviderModel[]; presetEmbeddings: string[] }
> = {
  anthropic: {
    label: "Anthropic (Claude)",
    keyHint: "sk-ant-…",
    needsBaseUrl: false,
    embeddings: false,
    presetModels: [
      claude("claude-sonnet-5", "Claude Sonnet 5"),
      claude("claude-opus-5", "Claude Opus 5"),
      claude("claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
    ],
    presetEmbeddings: [],
  },
  openai: {
    label: "OpenAI",
    keyHint: "sk-…",
    needsBaseUrl: false,
    embeddings: true,
    presetModels: [],
    presetEmbeddings: ["text-embedding-3-small", "text-embedding-3-large"],
  },
  google: {
    label: "Google (Gemini)",
    keyHint: "AIza…",
    needsBaseUrl: false,
    embeddings: true,
    presetModels: [],
    presetEmbeddings: [],
  },
  openai_compatible: {
    label: "OpenAI uyumlu uç nokta",
    keyHint: "Sağlayıcının anahtarı",
    needsBaseUrl: true,
    embeddings: true,
    presetModels: [],
    presetEmbeddings: [],
  },
};

export class ModelConfigError extends Error {}

function factory(p: ProviderRow) {
  const apiKey = decryptOrNull(p.apiKeyEnc);
  if (!apiKey) throw new ModelConfigError(`"${p.name}" sağlayıcısının API anahtarı girilmemiş.`);
  const baseURL = p.baseUrl || undefined;
  switch (p.kind) {
    case "anthropic": {
      const a = createAnthropic({ apiKey, baseURL });
      return { chat: (id: string) => a(id), embed: null };
    }
    case "openai": {
      const o = createOpenAI({ apiKey, baseURL });
      return { chat: (id: string) => o(id), embed: (id: string) => o.embedding(id) };
    }
    case "google": {
      const g = createGoogleGenerativeAI({ apiKey, baseURL });
      return { chat: (id: string) => g(id), embed: (id: string) => g.embedding(id) };
    }
    case "openai_compatible": {
      if (!baseURL) throw new ModelConfigError(`"${p.name}" için temel adres (base URL) girilmemiş.`);
      const o = createOpenAI({ apiKey, baseURL });
      // Uyumlu sunucular Responses API'yi desteklemez; Chat Completions kullanılır.
      return { chat: (id: string) => o.chat(id), embed: (id: string) => o.embedding(id) };
    }
  }
}

export async function getProvider(id: string): Promise<ProviderRow | null> {
  const [p] = await db.select().from(providers).where(eq(providers.id, id));
  return p ?? null;
}

export async function resolveModel(providerId: string, modelId: string): Promise<{ model: LanguageModel; meta: ProviderModel; provider: ProviderRow }> {
  const provider = await getProvider(providerId);
  if (!provider) throw new ModelConfigError("Seçili model sağlayıcısı silinmiş. Asistan ayarlarından yeni bir model seçin.");
  const meta = provider.models.find((m) => m.id === modelId) ?? {
    id: modelId,
    label: modelId,
    vision: false,
    tools: true,
    inputPer1M: 0,
    outputPer1M: 0,
  };
  return { model: factory(provider).chat(modelId), meta, provider };
}

export async function resolveEmbedding(): Promise<{ model: EmbeddingModel; id: string } | null> {
  const cfg = await getSetting("embedding");
  if (!cfg.providerId || !cfg.model) return null;
  const provider = await getProvider(cfg.providerId);
  if (!provider) return null;
  const f = factory(provider);
  if (!f.embed) return null;
  return { model: f.embed(cfg.model), id: `${provider.kind}/${cfg.model}` };
}

export function costOf(meta: ProviderModel, inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * (meta.inputPer1M || 0) + (outputTokens / 1_000_000) * (meta.outputPer1M || 0);
}

/** Paneldeki "Bağlantıyı test et" butonu. */
export async function testModel(providerId: string, modelId: string): Promise<{ ok: boolean; ms: number; message: string }> {
  const started = Date.now();
  try {
    const { model } = await resolveModel(providerId, modelId);
    const res = await generateText({ model, prompt: "Yalnızca 'tamam' yaz.", maxOutputTokens: 16 });
    return { ok: true, ms: Date.now() - started, message: res.text.trim().slice(0, 60) || "(boş cevap)" };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, message: e instanceof Error ? e.message : String(e) };
  }
}
