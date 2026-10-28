import { createUIMessageStreamResponse, generateText, isStepCount, streamText, toUIMessageStream, type ModelMessage } from "ai";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appUsers,
  attachments,
  botVersions,
  conversations,
  messages,
  type ChatMode,
  type Platform,
  type SourceRecord,
  type ToolCallRecord,
} from "@/db/schema";
import { normalizeBotConfig, TONES, TOOLS, type BotConfig, type ModeConfig, type ToneId } from "@/lib/bot-config";
import { getPublishedVersion, type BotRow, type BotVersionRow } from "@/lib/bot";
import { runImageWork } from "@/lib/image-limiter";
import { ensureClean } from "@/lib/image-sanitize";
import { storage } from "@/lib/storage";
import { buildInstructions, hasHealthContext, type AnswerFormat, type ClientContext } from "./prompt";
import { citedNumbers, stripCitations } from "./citations";
import { embeddingCostOf } from "./embedding-cost";
import { costOf, ModelConfigError, resolveModel } from "./providers";
import { shapePreview, splitContext, type PreviewResponse } from "./prompt-preview-core";
import { searchKnowledgeRanked, searchKnowledgeWithUsage, type KnowledgeHit, type RankedKnowledgeHit } from "./retrieval";
import { buildSearchQuery, isUnanswered } from "./retrieval-core";
import { buildTools } from "./tools";
import type { UserLocation } from "./location";
import { effectiveMaxOutputTokens, isReasoningModel } from "./model-meta";
import { abortedContent, abortKind, abortedUsage, ChatError, dailyLimitRetryAfter, describeError, effectiveTarget, exposeTurnData, isForeignKeyViolation, promptChars, type TurnTarget } from "./turn-core";
import { redactToolStream, stripCitationStream } from "./ui-stream";

/*
 * Bir sohbet turunun orkestratörü üç parçadır:
 *   prepareTurn   → doğrulama, kayıt (kullanıcı mesajı), retrieval, prompt, araçlar
 *   streamTurn    → akışlı cevap (widget, test alanı)        ┐ ikisi de cevabı
 *   runTurnOnce   → akışsız tek seferlik cevap (köprü, koşu) ┘ persistAssistant ile kaydeder
 * Widget/köprü ve test alanı ayrımı (araç çıktısı süzgeci, `target`) burada tek yerde uygulanır.
 */

type AppUserRow = typeof appUsers.$inferSelect;
type AttachmentRow = typeof attachments.$inferSelect;
type Resolved = Awaited<ReturnType<typeof resolveModel>>;

export { ChatError };

export type { TurnTarget } from "./turn-core";

export type ChatInput = {
  bot: BotRow;
  appUser: AppUserRow | null;
  platform: Platform;
  conversationId: string;
  mode: ChatMode;
  text: string;
  attachmentIds: string[];
  location: UserLocation;
  /** Test alanı: taslak ayarlar ve hazır olan tüm kaynaklar. */
  useDraft: boolean;
  /** Yalnızca platform "playground" iken geçerli; yoksa `useDraft`'a göre taslak/yayındaki sürüm. */
  target?: TurnTarget;
  /** "none": konuşma ve mesaj yazılmaz, geçmiş okunmaz (prompt önizleme, senaryo koşusu). */
  persist?: "conversation" | "none";
  /** Moddaki tonu bu tonla değiştirir (mobil köprü). Geçersiz değer yok sayılır. */
  tone?: ToneId;
  /** Mobil uygulamanın eklediği bağlam (şehir, hava, seyahat, profil). Yalnızca prompt'a veri olarak girer; veritabanına yazılmaz. */
  clientContext?: ClientContext;
  /** "plain": cevap düz metin istenir (mobil köprü). Yoksa prompt değişmez. */
  answerFormat?: AnswerFormat;
  /** İstemci bağlantıyı kapatırsa (Durdur) model çağrısı da kesilir. */
  abortSignal?: AbortSignal;
};

export type SavedAssistant = {
  id: string;
  content: string;
  unanswered: boolean;
  inputTokens: number;
  outputTokens: number;
  /** Model + arama (sorgu embedding'i) maliyeti toplamı. */
  costUsd: number;
  latencyMs: number;
  error: string | null;
  /** Kaynaklar; cevapta [n] ile anılanlar `cited: true`. */
  sources: SourceRecord[];
};

export type PreparedTurn = {
  input: ChatInput;
  started: number;
  config: BotConfig;
  modeCfg: ModeConfig;
  persist: boolean;
  conversationId: string;
  versionNumber: number | null;
  resolved: Resolved;
  instructions: string;
  modelMessages: ModelMessage[];
  tools: ReturnType<typeof buildTools> | undefined;
  toolsAvailable: boolean;
  hits: KnowledgeHit[];
  sources: SourceRecord[];
  /** Bilgi tabanında gerçekte aranan sorgu (takip sorularında önceki mesajla birleşir). */
  searchQuery: string;
  /** Sorgu embedding'inin token sayısı ve maliyeti (USD); vektör araması yapılmadıysa 0. */
  embeddingTokens: number;
  embeddingCostUsd: number;
  assistantId: string;
  modelLabel: string;
  /** persistAssistant ilk çağrıdan sonra sonucu tutar; tekrar çağrılırsa aynı kayıt döner. */
  saved: Promise<SavedAssistant> | null;
};

const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const PHOTO_MEMORY = 2; // Modele baytlarıyla gönderilen son fotoğraflı mesaj sayısı.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function userMessage(text: string, photos: AttachmentRow[], includeImages: boolean, visionModel: boolean): Promise<ModelMessage> {
  const visible = photos.filter((p) => !p.hidden);
  if (!visible.length) return { role: "user", content: text || "…" };
  const sendable = includeImages && visionModel ? visible.filter((p) => VISION_TYPES.has(p.mediaType)) : [];
  const notes: string[] = [];
  if (sendable.length < visible.length) {
    notes.push(
      visionModel
        ? `[Kullanıcı ${visible.length} fotoğraf gönderdi; önceki fotoğraflar bu mesaja eklenmedi.]`
        : `[Kullanıcı ${visible.length} fotoğraf gönderdi ama seçili model görselleri göremiyor; bunu kullanıcıya söyle.]`,
    );
  }
  if (!sendable.length) return { role: "user", content: [text, ...notes].filter(Boolean).join("\n") };
  const files = await Promise.all(sendable.map((p) => storage.get(p.storageKey)));
  // Eski (temizlenmemiş) dosyalar modele meta verisiyle gitmesin: bellekte temizlenir, temizlenemeyen gönderilmez.
  const cleaned = await Promise.all(files.map((f, i) => (f ? runImageWork(() => ensureClean(f.data, sendable[i].mediaType)).catch(() => null) : null)));
  if (files.some((f, i) => f && !cleaned[i])) notes.push("[Kullanıcının bir fotoğrafı işlenemedi.]");
  return {
    role: "user",
    content: [
      { type: "text", text: [text || "Bu fotoğrafa bakar mısın?", ...notes].join("\n") },
      ...cleaned.flatMap((data, i) => (data ? [{ type: "file" as const, mediaType: sendable[i].mediaType, data }] : [])),
    ],
  };
}

type Settings = {
  config: BotConfig;
  allowedSourceIds: string[] | null;
  frozenEmbedding: BotVersionRow["embedding"];
  versionNumber: number | null;
};

/** Hedefe göre ayarlar: taslak (tüm kaynaklar) ya da sürüm (dondurulmuş kaynak listesi ve embedding). */
async function resolveSettings(input: Pick<ChatInput, "bot" | "platform" | "useDraft" | "target">): Promise<Settings> {
  const target = effectiveTarget(input);
  if (target === "draft") {
    return { config: normalizeBotConfig(input.bot.draftConfig), allowedSourceIds: null, frozenEmbedding: null, versionNumber: null };
  }
  let v: BotVersionRow | null;
  if (target === "published") {
    v = await getPublishedVersion(input.bot);
    if (!v) throw new ChatError("Asistan henüz yayınlanmadı.", 503, "not_configured");
  } else {
    // Sürüm kimliği başka bota ait olabilir; bot koşulu sızıntıyı engeller.
    if (!UUID_RE.test(target.versionId)) throw new ChatError("Sürüm bulunamadı.", 404, "version_not_found");
    const [row] = await db
      .select()
      .from(botVersions)
      .where(and(eq(botVersions.id, target.versionId), eq(botVersions.botId, input.bot.id)));
    if (!row) throw new ChatError("Sürüm bulunamadı.", 404, "version_not_found");
    v = { ...row, config: normalizeBotConfig(row.config, { frozen: true }) };
  }
  return { config: v.config, allowedSourceIds: v.kbSourceIds, frozenEmbedding: v.embedding, versionNumber: v.number };
}

/**
 * Prompt önizleme: seçilen hedef için sistem talimatını (bilgi tabanı bloğu dahil) kurar,
 * model çağırmaz ve hiçbir şey yazmaz. Hedef çözümü sohbetle aynıdır (`resolveSettings`):
 * sürüm bu bota ait değilse 404, yayın yoksa 503. Model seçili değilse de çalışır.
 */
export async function previewPrompt(input: { bot: BotRow; mode: ChatMode; text: string; location: UserLocation; target: TurnTarget }): Promise<PreviewResponse> {
  const { bot, mode, text, location, target } = input;
  const { config, allowedSourceIds, frozenEmbedding, versionNumber } = await resolveSettings({ bot, platform: "playground", useDraft: true, target });
  const modeCfg = config.modes[mode];
  if (!modeCfg?.enabled) throw new ChatError("Bu mod şu anda kapalı.", 400, "mode_disabled");

  const notes: string[] = [];
  let ranked: RankedKnowledgeHit[] = [];
  try {
    ranked = await searchKnowledgeRanked({
      botId: bot.id,
      mode,
      query: text,
      allowedSourceIds,
      embedding: frozenEmbedding,
      topK: config.retrievalTopK,
      minSimilarity: config.retrievalMinSimilarity,
      domainStopwords: config.domainStopwords,
      perSourceMax: config.retrievalPerSourceMax,
    });
  } catch (e) {
    console.error("[prompt-preview] bilgi tabanı araması başarısız:", e);
    notes.push("Bilgi tabanı araması başarısız oldu; prompt bilgi tabanı içeriği olmadan gösteriliyor.");
  }
  const { context, candidates } = splitContext(ranked, config.retrievalTopK);

  let model: string | null = null;
  let toolsAvailable = false;
  if (modeCfg.providerId && modeCfg.model) {
    try {
      const r = await resolveModel(modeCfg.providerId, modeCfg.model);
      model = `${r.provider.kind}/${r.meta.id}`;
      toolsAvailable = r.meta.tools;
      if (!toolsAvailable) notes.push("Seçili model araç kullanamıyor; canlı veri araçları prompt'a eklenmedi.");
    } catch (e) {
      notes.push(e instanceof ModelConfigError ? e.message : "Model yüklenemedi.");
    }
  } else {
    notes.push("Bu mod için model seçilmedi; araç bölümü gösterilemiyor.");
  }

  const instructions = buildInstructions({ config, mode, hits: context, location, toolsAvailable });
  return shapePreview({
    instructions,
    candidates,
    toolsAvailable,
    tools: toolsAvailable ? modeCfg.tools.map((t) => `${TOOLS[t].label} (${t})`) : [],
    model,
    targetLabel: target === "draft" ? "Taslak" : versionNumber !== null ? `v${versionNumber}` : "Sürüm",
    notes,
  });
}

export async function prepareTurn(input: ChatInput): Promise<PreparedTurn> {
  const started = Date.now();
  const { bot, appUser } = input;
  const persist = (input.persist ?? "conversation") === "conversation";

  /* 1. Hangi ayarlar: taslak (test alanı) mı, yayındaki sürüm mü? */
  const { config: baseConfig, allowedSourceIds, frozenEmbedding, versionNumber } = await resolveSettings(input);
  let config = baseConfig;
  if (input.tone && Object.hasOwn(TONES, input.tone)) {
    config = { ...config, modes: { ...config.modes, [input.mode]: { ...config.modes[input.mode], tone: input.tone } } };
  }
  const modeCfg = config.modes[input.mode];
  if (!modeCfg?.enabled) throw new ChatError("Bu mod şu anda kapalı.", 400, "mode_disabled");
  if (!modeCfg.providerId || !modeCfg.model) {
    throw new ChatError("Bu mod için henüz bir yapay zekâ modeli seçilmedi.", 503, "not_configured");
  }

  const text = input.text.trim().slice(0, 4000);
  if (!text && !input.attachmentIds.length) throw new ChatError("Mesaj boş.", 400, "empty");

  /* 2. Günlük sınır */
  if (appUser && config.maxMessagesPerDay > 0) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [{ n, oldestMs }] = await db
      .select({ n: sql<number>`count(*)::int`, oldestMs: sql<number | null>`(extract(epoch from min(${messages.createdAt})) * 1000)::float8` })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(conversations.appUserId, appUser.id), eq(messages.role, "user"), gte(messages.createdAt, since)));
    if (n >= config.maxMessagesPerDay) {
      throw new ChatError("Günlük mesaj sınırına ulaştınız. Yarın tekrar deneyebilirsiniz.", 429, "daily_limit", dailyLimitRetryAfter(oldestMs, Date.now()));
    }
  }

  /* 3. Model */
  let resolved: Resolved;
  try {
    resolved = await resolveModel(modeCfg.providerId, modeCfg.model);
  } catch (e) {
    throw new ChatError(e instanceof ModelConfigError ? e.message : "Model yüklenemedi.", 503, "not_configured");
  }

  /* 4. Konuşma: yoksa oluştur, varsa sahipliğini doğrula */
  const conversationId = input.conversationId;
  if (persist) {
    const [existing] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (existing) {
      if (existing.botId !== bot.id || (existing.appUserId ?? null) !== (appUser?.id ?? null)) {
        throw new ChatError("Konuşma bulunamadı.", 404, "conversation_not_found");
      }
      // Bir konuşma tek moddadır; mod değişince istemci yeni konuşma açar.
      if (existing.mode !== input.mode) {
        throw new ChatError("Bu konuşma başka bir modda. Yeni bir konuşma başlatın.", 409, "conversation_mode_mismatch");
      }
    } else {
      try {
        await db.insert(conversations).values({
          id: conversationId,
          botId: bot.id,
          appUserId: appUser?.id ?? null,
          mode: input.mode,
          platform: input.platform,
          versionNumber,
          title: (text || "Fotoğraf").slice(0, 80),
        });
      } catch (e) {
        // Kullanıcı bu arada silindi (KVKK silme satırı kilitler; kilit kalkınca FK hatası gelir). Sahipsiz konuşma açılmaz.
        if (isForeignKeyViolation(e)) throw new ChatError("Konuşma bulunamadı.", 404, "conversation_not_found");
        throw e;
      }
    }
  }

  /* 5. Bu mesajın fotoğrafları: yalnızca bu kullanıcının, henüz bağlanmamış yüklemeleri */
  let photos: AttachmentRow[] = [];
  if (persist && input.attachmentIds.length) {
    if (!config.photosEnabled) throw new ChatError("Fotoğraf gönderimi şu anda kapalı.", 400, "photos_disabled");
    photos = await db
      .select()
      .from(attachments)
      .where(
        and(
          inArray(attachments.id, input.attachmentIds.slice(0, 4)),
          isNull(attachments.messageId),
          appUser ? eq(attachments.appUserId, appUser.id) : isNull(attachments.appUserId),
        ),
      );
  }

  /* 6. Geçmiş (veritabanından; istemcinin gönderdiği geçmişe güvenilmez) */
  const history = persist
    ? (await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(desc(messages.createdAt)).limit(config.historyWindow)).reverse()
    : [];
  const histPhotos = history.length
    ? await db.select().from(attachments).where(inArray(attachments.messageId, history.map((h) => h.id)))
    : [];

  /* 7. Kullanıcı mesajını kaydet */
  if (persist) {
    const userRow = await db
      .insert(messages)
      .values({ conversationId, role: "user", content: text })
      .returning()
      .then(([row]) => row)
      .catch((e: unknown) => {
        // Konuşma bu arada silindi (KVKK silme).
        if (isForeignKeyViolation(e)) throw new ChatError("Konuşma bulunamadı.", 404, "conversation_not_found");
        throw e;
      });
    if (photos.length) {
      await db.update(attachments).set({ messageId: userRow.id, conversationId }).where(inArray(attachments.id, photos.map((p) => p.id)));
    }
    await db
      .update(conversations)
      .set({
        messageCount: sql`${conversations.messageCount} + 1`,
        photoCount: sql`${conversations.photoCount} + ${photos.length}`,
        lastMessageAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
  }

  /* 8. Bilgi tabanı araması: takip sorusunda sorgu önceki kullanıcı mesajıyla birleşir (kural tabanlı) */
  const previousUserTexts = history.filter((m) => m.role === "user" && m.content).map((m) => m.content);
  const { query, followUp } = buildSearchQuery(previousUserTexts, text);
  let hits: KnowledgeHit[] = [];
  let embeddingTokens = 0;
  let embeddingCostUsd = 0;
  if (query) {
    try {
      const found = await searchKnowledgeWithUsage({
        botId: bot.id,
        mode: input.mode,
        query,
        alsoQuery: followUp ? text : undefined,
        allowedSourceIds,
        embedding: frozenEmbedding,
        topK: config.retrievalTopK,
        minSimilarity: config.retrievalMinSimilarity,
        domainStopwords: config.domainStopwords,
        perSourceMax: config.retrievalPerSourceMax,
      });
      hits = found.hits;
      embeddingTokens = found.usage.embeddingTokens;
      embeddingCostUsd = embeddingCostOf(embeddingTokens, found.usage.embeddingPricePer1M);
    } catch (e) {
      console.error("[chat] bilgi tabanı araması başarısız:", e);
    }
  }

  /* 9. Model mesajları */
  const photoMsgIds = history.filter((m) => m.role === "user" && histPhotos.some((p) => p.messageId === m.id)).map((m) => m.id);
  const recentPhotoIds = new Set(photoMsgIds.slice(-(PHOTO_MEMORY - (photos.length ? 1 : 0))));
  const modelMessages: ModelMessage[] = [];
  for (const m of history) {
    if (m.role === "assistant") {
      if (m.content) modelMessages.push({ role: "assistant", content: m.content });
      continue;
    }
    const own = histPhotos.filter((p) => p.messageId === m.id);
    modelMessages.push(await userMessage(m.content, own, recentPhotoIds.has(m.id), resolved.meta.vision));
  }
  modelMessages.push(await userMessage(text, photos, true, resolved.meta.vision));

  /* 10. Prompt ve araçlar */
  const toolsAvailable = resolved.meta.tools;
  const tools = toolsAvailable ? buildTools(modeCfg.tools, { location: input.location }) : undefined;
  const instructions = buildInstructions({
    config,
    mode: input.mode,
    hits,
    location: input.location,
    toolsAvailable,
    clientContext: input.clientContext,
    answerFormat: input.answerFormat,
  });
  // Sağlık hassasiyeti (KVKK m. 6) yalnızca gerçekten prompt'a girdiyse konuşma işaretlenir: cevaplar bu bilgiye dayanabilir,
  // bu yüzden pii yetkisi olmayan roller içeriği görmez ve konuşmadan senaryo/düzeltme kopyası alınamaz. İşaret geri alınmaz.
  if (persist && hasHealthContext(input.clientContext)) {
    await db.update(conversations).set({ healthContext: true }).where(eq(conversations.id, conversationId));
  }
  const sources: SourceRecord[] = hits.map((h) => ({
    sourceId: h.sourceId,
    title: h.title,
    snippet: h.content.slice(0, 280),
    score: Math.round(h.score * 100) / 100,
    chunkId: h.chunkId,
    similarity: h.similarity === null ? null : Math.round(h.similarity * 1000) / 1000,
    lexical: h.lexical,
    rank: h.rank,
  }));

  return {
    input,
    started,
    config,
    modeCfg,
    persist,
    conversationId,
    versionNumber,
    resolved,
    instructions,
    modelMessages,
    tools,
    toolsAvailable,
    hits,
    sources,
    searchQuery: query,
    embeddingTokens,
    embeddingCostUsd,
    assistantId: crypto.randomUUID(),
    modelLabel: `${resolved.provider.kind}/${resolved.meta.id}`,
    saved: null,
  };
}

/** Cevabı (persist "conversation" ise) kaydeder. Bir tur için yalnızca ilk çağrı yazar. */
export function persistAssistant(
  turn: PreparedTurn,
  r: { content: string; toolCalls: ToolCallRecord[]; inTok: number; outTok: number; error: string | null; aborted?: boolean },
): Promise<SavedAssistant> {
  if (turn.saved) return turn.saved;
  turn.saved = (async () => {
    const { config, conversationId, assistantId } = turn;
    // Model + arama maliyeti; arama (sorgu embedding'i) ayrıca embedding_cost_usd'de tutulur.
    const cost = costOf(turn.resolved.meta, r.inTok, r.outTok) + turn.embeddingCostUsd;
    // Atıflar ([n]) modelden istenir ama son kullanıcıya gösterilmez: kayıtlı metinden silinir,
    // hangi kaynakların anıldığı yalnızca kaynak kaydındaki `cited` alanında kalır (panelde görünür).
    const rawContent = r.content || (r.error ? config.fallbackMessage : "");
    const cited = new Set(citedNumbers(rawContent, turn.sources.length));
    const content = stripCitations(rawContent, turn.sources.length);
    const sources = turn.sources.map((s, i) => ({ ...s, cited: cited.has(i + 1) }));
    const unanswered = isUnanswered({ relevantHits: sources.length, toolCalls: r.toolCalls, error: r.error, aborted: r.aborted ?? false });
    const latencyMs = Date.now() - turn.started;
    if (turn.persist) {
      await db.insert(messages).values({
        id: assistantId,
        conversationId,
        role: "assistant",
        content,
        toolCalls: r.toolCalls,
        sources,
        unanswered,
        model: turn.modelLabel,
        inputTokens: r.inTok,
        outputTokens: r.outTok,
        costUsd: cost,
        searchQuery: turn.searchQuery || null,
        embeddingTokens: turn.embeddingTokens || null,
        embeddingCostUsd: turn.embeddingTokens ? turn.embeddingCostUsd : null,
        latencyMs,
        error: r.error,
      });
      await db
        .update(conversations)
        .set({
          messageCount: sql`${conversations.messageCount} + 1`,
          inputTokens: sql`${conversations.inputTokens} + ${r.inTok}`,
          outputTokens: sql`${conversations.outputTokens} + ${r.outTok}`,
          costUsd: sql`${conversations.costUsd} + ${cost}`,
          lastMessageAt: new Date(),
        })
        .where(eq(conversations.id, conversationId));
    }
    return { id: assistantId, content, unanswered, inputTokens: r.inTok, outputTokens: r.outTok, costUsd: cost, latencyMs, error: r.error, sources };
  })();
  return turn.saved;
}

/**
 * Sağlayıcıya gönderilen çıktı sınırı: moddaki ayar; muhakeme modelinde düşünme payı eklenir.
 * Ayar tanımsızsa (bu alan eklenmeden yayınlanmış eski sürüm) sınır gönderilmez.
 */
export function outputCap(turn: Pick<PreparedTurn, "modeCfg" | "resolved">): number | undefined {
  return effectiveMaxOutputTokens(turn.modeCfg.maxOutputTokens, isReasoningModel(turn.resolved.meta.id));
}

type StepLike = { toolResults: { toolName: unknown; input: unknown; output: unknown }[] };

function toolCallsOf(steps: StepLike[]): ToolCallRecord[] {
  return steps.flatMap((s) => s.toolResults.map((r) => ({ name: String(r.toolName), input: r.input, output: r.output })));
}

/** Akışlı cevap: widget ve test alanı. Widget/köprü akışında araç girdi/çıktısı ve ham hata metni istemciye gitmez. */
export function streamTurn(turn: PreparedTurn): Response {
  const { input, config, modeCfg, instructions, modelMessages } = turn;

  // Durdurulan cevapta yarım kalan adım `steps` içinde yer almaz; kullanıcının
  // ekranda gördüğü metni kaybetmemek için akışı burada da biriktiriyoruz.
  let streamed = "";

  const result = streamText({
    model: turn.resolved.model,
    instructions,
    messages: modelMessages,
    tools: turn.tools,
    stopWhen: isStepCount(4),
    temperature: modeCfg.temperature,
    maxOutputTokens: outputCap(turn),
    abortSignal: input.abortSignal,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") streamed += chunk.text;
    },
    onEnd: async (e) => {
      await persistAssistant(turn, {
        content: e.text,
        toolCalls: toolCallsOf(e.steps),
        inTok: e.totalUsage.inputTokens ?? 0,
        outTok: e.totalUsage.outputTokens ?? 0,
        error: null,
      });
    },
    // Kullanıcı "Durdur"a bastı: o ana kadar üretilen cevabı ve harcanan token'ı kaydet.
    onAbort: async (e) => {
      // Sağlayıcı yarım adımın kullanımını bildirmez; istek yine de faturalanır.
      // Maliyet takibi için karakter sayısından (~4 karakter/token) tahmin edilir.
      const { inTok, outTok } = abortedUsage({
        promptChars: promptChars(instructions, modelMessages),
        outputChars: streamed.length,
        reportedIn: e.steps.reduce((a, s) => a + (s.usage.inputTokens ?? 0), 0),
        reportedOut: e.steps.reduce((a, s) => a + (s.usage.outputTokens ?? 0), 0),
      });
      await persistAssistant(turn, {
        content: abortedContent(streamed, abortKind(input.abortSignal)),
        toolCalls: toolCallsOf(e.steps),
        inTok,
        outTok,
        error: null,
        aborted: true,
      });
    },
    onError: async ({ error }) => {
      // Ham hata nesnesi istek gövdesini (prompt, uygulama bağlamı) taşıyabilir; yalnızca sınıf ve durum loglanır.
      console.error("[chat] model hatası:", describeError(error));
      await persistAssistant(turn, {
        content: "",
        toolCalls: [],
        inTok: 0,
        outTok: 0,
        error: describeError(error),
      });
    },
  });

  const uiStream = toUIMessageStream({
    stream: result.stream,
    generateMessageId: () => turn.assistantId,
    sendReasoning: false,
    onError: () => config.fallbackMessage,
  });
  // Son kullanıcı (widget, mobil köprü) araç girdi/çıktısını, ham hata metnini ve kaynak atıflarını ([n]) görmez;
  // yalnızca test alanı görür.
  return createUIMessageStreamResponse({ stream: input.platform === "playground" ? uiStream : redactToolStream(stripCitationStream(uiStream, turn.sources.length)) });
}

export type TurnResult = {
  messageId: string;
  /** Model hatasında `fallbackMessage`; kullanıcıya gösterilecek metin. */
  text: string;
  /** Model hatası (iç metin; kullanıcıya gösterilmemeli). Başarıda null. */
  error: string | null;
  /** Çağrı iptal/zaman aşımıyla kesildi (kayıt kısmi metin + not taşır). Tam cevap kaydedildiyse false; sonradan tetiklenen sinyal bunu değiştirmez. */
  aborted: boolean;
  unanswered: boolean;
  conversationId: string;
  versionNumber: number | null;
  toolNames: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  /** Yalnızca test alanında (platform "playground") dolu; widget ve köprüde boş. */
  toolCalls: ToolCallRecord[];
  sources: SourceRecord[];
};

/**
 * Akışsız tek seferlik cevap (`generateText`): mobil köprü ve senaryo koşusu için.
 * Kayıt `persistAssistant` ile aynıdır (persist "none" ise yazılmaz). Model hatası
 * fırlatılmaz, `error` alanında döner. İptal/zaman aşımında tamamlanmış adımların metni kısmi cevap olur
 * ve token kullanımı karakterden tahmin edilir (streamTurn ile aynı kural).
 */
export async function runTurnOnce(turn: PreparedTurn): Promise<TurnResult> {
  const { input, modeCfg } = turn;
  let saved: SavedAssistant;
  let aborted = false;
  let toolCalls: ToolCallRecord[] = [];
  // İptal/zaman aşımında tamamlanmış adımların metni ve kullanımı (streamTurn'deki onAbort ile tutarlı).
  const doneSteps: (StepLike & { text: string; usage: { inputTokens?: number; outputTokens?: number } })[] = [];
  try {
    const res = await generateText({
      model: turn.resolved.model,
      instructions: turn.instructions,
      messages: turn.modelMessages,
      tools: turn.tools,
      stopWhen: isStepCount(4),
      temperature: modeCfg.temperature,
      maxOutputTokens: outputCap(turn),
      abortSignal: input.abortSignal,
      onStepEnd: (step) => {
        doneSteps.push(step);
      },
    });
    toolCalls = toolCallsOf(res.steps);
    saved = await persistAssistant(turn, {
      content: res.text,
      toolCalls,
      inTok: res.totalUsage.inputTokens ?? 0,
      outTok: res.totalUsage.outputTokens ?? 0,
      error: null,
    });
  } catch (e) {
    if (input.abortSignal?.aborted) {
      aborted = true;
      const partial = doneSteps.map((s) => s.text).join("");
      const { inTok, outTok } = abortedUsage({
        promptChars: promptChars(turn.instructions, turn.modelMessages),
        outputChars: partial.length,
        reportedIn: doneSteps.reduce((a, s) => a + (s.usage.inputTokens ?? 0), 0),
        reportedOut: doneSteps.reduce((a, s) => a + (s.usage.outputTokens ?? 0), 0),
      });
      toolCalls = toolCallsOf(doneSteps);
      saved = await persistAssistant(turn, { content: abortedContent(partial, abortKind(input.abortSignal)), toolCalls, inTok, outTok, error: null, aborted: true });
    } else {
      console.error("[chat] model hatası:", describeError(e));
      saved = await persistAssistant(turn, {
        content: "",
        toolCalls: [],
        inTok: 0,
        outTok: 0,
        error: describeError(e),
      });
    }
  }
  return {
    messageId: saved.id,
    text: saved.content,
    error: saved.error,
    aborted,
    unanswered: saved.unanswered,
    conversationId: turn.conversationId,
    versionNumber: turn.versionNumber,
    inputTokens: saved.inputTokens,
    outputTokens: saved.outputTokens,
    costUsd: saved.costUsd,
    latencyMs: saved.latencyMs,
    ...exposeTurnData(input.platform, { toolCalls, sources: saved.sources }),
  };
}
