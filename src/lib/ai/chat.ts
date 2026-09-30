import { createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type ModelMessage } from "ai";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  appUsers,
  attachments,
  conversations,
  messages,
  type ChatMode,
  type Platform,
  type SourceRecord,
  type ToolCallRecord,
} from "@/db/schema";
import { normalizeBotConfig, type BotConfig } from "@/lib/bot-config";
import { getPublishedVersion, type BotRow } from "@/lib/bot";
import { storage } from "@/lib/storage";
import { buildInstructions } from "./prompt";
import { costOf, ModelConfigError, resolveModel } from "./providers";
import { searchKnowledge, type KnowledgeHit } from "./retrieval";
import { buildTools, type UserLocation } from "./tools";

type AppUserRow = typeof appUsers.$inferSelect;
type AttachmentRow = typeof attachments.$inferSelect;

export class ChatError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

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
  /** İstemci bağlantıyı kapatırsa (Durdur) model çağrısı da kesilir. */
  abortSignal?: AbortSignal;
};

const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const PHOTO_MEMORY = 2; // Modele baytlarıyla gönderilen son fotoğraflı mesaj sayısı.

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
  return {
    role: "user",
    content: [
      { type: "text", text: [text || "Bu fotoğrafa bakar mısın?", ...notes].join("\n") },
      ...files.flatMap((f, i) => (f ? [{ type: "file" as const, mediaType: sendable[i].mediaType, data: f.data }] : [])),
    ],
  };
}

export async function handleChat(input: ChatInput): Promise<Response> {
  const started = Date.now();
  const { bot, appUser } = input;

  /* 1. Hangi ayarlar: taslak (test alanı) mı, yayındaki sürüm mü? */
  let config: BotConfig;
  let allowedSourceIds: string[] | null = null;
  let versionNumber: number | null = null;
  if (input.useDraft) {
    config = normalizeBotConfig(bot.draftConfig);
  } else {
    const v = await getPublishedVersion(bot);
    if (!v) throw new ChatError("Asistan henüz yayınlanmadı.", 503);
    config = v.config;
    allowedSourceIds = v.kbSourceIds;
    versionNumber = v.number;
  }
  const modeCfg = config.modes[input.mode];
  if (!modeCfg?.enabled) throw new ChatError("Bu mod şu anda kapalı.", 400);
  if (!modeCfg.providerId || !modeCfg.model) {
    throw new ChatError("Bu mod için henüz bir yapay zekâ modeli seçilmedi.", 503);
  }

  const text = input.text.trim().slice(0, 4000);
  if (!text && !input.attachmentIds.length) throw new ChatError("Mesaj boş.", 400);

  /* 2. Günlük sınır */
  if (appUser && config.maxMessagesPerDay > 0) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(conversations.appUserId, appUser.id), eq(messages.role, "user"), gte(messages.createdAt, since)));
    if (n >= config.maxMessagesPerDay) {
      throw new ChatError("Günlük mesaj sınırına ulaştınız. Yarın tekrar deneyebilirsiniz.", 429);
    }
  }

  /* 3. Model */
  let resolved: Awaited<ReturnType<typeof resolveModel>>;
  try {
    resolved = await resolveModel(modeCfg.providerId, modeCfg.model);
  } catch (e) {
    throw new ChatError(e instanceof ModelConfigError ? e.message : "Model yüklenemedi.", 503);
  }

  /* 4. Konuşma: yoksa oluştur, varsa sahipliğini doğrula */
  const conversationId = input.conversationId;
  const [existing] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (existing) {
    if (existing.botId !== bot.id || (existing.appUserId ?? null) !== (appUser?.id ?? null)) {
      throw new ChatError("Konuşma bulunamadı.", 404);
    }
    // Bir konuşma tek moddadır; mod değişince istemci yeni konuşma açar.
    if (existing.mode !== input.mode) {
      throw new ChatError("Bu konuşma başka bir modda. Yeni bir konuşma başlatın.", 409);
    }
  } else {
    await db.insert(conversations).values({
      id: conversationId,
      botId: bot.id,
      appUserId: appUser?.id ?? null,
      mode: input.mode,
      platform: input.platform,
      versionNumber,
      title: (text || "Fotoğraf").slice(0, 80),
    });
  }

  /* 5. Bu mesajın fotoğrafları: yalnızca bu kullanıcının, henüz bağlanmamış yüklemeleri */
  let photos: AttachmentRow[] = [];
  if (input.attachmentIds.length) {
    if (!config.photosEnabled) throw new ChatError("Fotoğraf gönderimi şu anda kapalı.", 400);
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
  const history = (
    await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(desc(messages.createdAt)).limit(config.historyWindow)
  ).reverse();
  const histPhotos = history.length
    ? await db.select().from(attachments).where(inArray(attachments.messageId, history.map((h) => h.id)))
    : [];

  /* 7. Kullanıcı mesajını kaydet */
  const [userRow] = await db.insert(messages).values({ conversationId, role: "user", content: text }).returning();
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

  /* 8. Bilgi tabanı araması */
  const lastUserText = [...history].reverse().find((m) => m.role === "user" && m.content)?.content ?? "";
  const query = text || lastUserText;
  let hits: KnowledgeHit[] = [];
  if (query) {
    try {
      hits = await searchKnowledge({ botId: bot.id, mode: input.mode, query, allowedSourceIds, topK: config.retrievalTopK });
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

  /* 10. Akış */
  const toolsAvailable = resolved.meta.tools;
  const tools = toolsAvailable ? buildTools(modeCfg.tools, { location: input.location }) : undefined;
  const instructions = buildInstructions({ config, mode: input.mode, hits, location: input.location, toolsAvailable });
  const assistantId = crypto.randomUUID();
  const sources: SourceRecord[] = hits.map((h) => ({
    sourceId: h.sourceId,
    title: h.title,
    snippet: h.content.slice(0, 280),
    score: Math.round(h.score * 100) / 100,
  }));
  const modelLabel = `${resolved.provider.kind}/${resolved.meta.id}`;
  let saved = false;

  const saveAssistant = async (content: string, toolCalls: ToolCallRecord[], inTok: number, outTok: number, error: string | null) => {
    if (saved) return;
    saved = true;
    const cost = costOf(resolved.meta, inTok, outTok);
    await db.insert(messages).values({
      id: assistantId,
      conversationId,
      role: "assistant",
      content: content || (error ? config.fallbackMessage : ""),
      toolCalls,
      sources,
      unanswered: !error && sources.length === 0 && toolCalls.length === 0,
      model: modelLabel,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: cost,
      latencyMs: Date.now() - started,
      error,
    });
    await db
      .update(conversations)
      .set({
        messageCount: sql`${conversations.messageCount} + 1`,
        inputTokens: sql`${conversations.inputTokens} + ${inTok}`,
        outputTokens: sql`${conversations.outputTokens} + ${outTok}`,
        costUsd: sql`${conversations.costUsd} + ${cost}`,
        lastMessageAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
  };

  // Durdurulan cevapta yarım kalan adım `steps` içinde yer almaz; kullanıcının
  // ekranda gördüğü metni kaybetmemek için akışı burada da biriktiriyoruz.
  let streamed = "";

  const result = streamText({
    model: resolved.model,
    instructions,
    messages: modelMessages,
    tools,
    stopWhen: isStepCount(4),
    temperature: modeCfg.temperature,
    abortSignal: input.abortSignal,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") streamed += chunk.text;
    },
    onEnd: async (e) => {
      const toolCalls: ToolCallRecord[] = e.steps.flatMap((s) =>
        s.toolResults.map((r) => ({ name: String(r.toolName), input: r.input, output: r.output })),
      );
      await saveAssistant(e.text, toolCalls, e.totalUsage.inputTokens ?? 0, e.totalUsage.outputTokens ?? 0, null);
    },
    // Kullanıcı "Durdur"a bastı: o ana kadar üretilen cevabı ve harcanan token'ı kaydet.
    onAbort: async (e) => {
      const toolCalls: ToolCallRecord[] = e.steps.flatMap((s) =>
        s.toolResults.map((r) => ({ name: String(r.toolName), input: r.input, output: r.output })),
      );
      // Sağlayıcı yarım adımın kullanımını bildirmez; istek yine de faturalanır.
      // Maliyet takibi için karakter sayısından (~4 karakter/token) tahmin edilir.
      const promptChars = instructions.length + JSON.stringify(modelMessages.map((m) => (typeof m.content === "string" ? m.content : ""))).length;
      const inTok = Math.max(e.steps.reduce((a, s) => a + (s.usage.inputTokens ?? 0), 0), Math.ceil(promptChars / 4));
      const outTok = Math.max(e.steps.reduce((a, s) => a + (s.usage.outputTokens ?? 0), 0), Math.ceil(streamed.length / 4));
      const text = streamed.trim();
      await saveAssistant(text ? `${text}\n\n(Kullanıcı cevabı durdurdu.)` : "(Kullanıcı cevabı durdurdu.)", toolCalls, inTok, outTok, null);
    },
    onError: async ({ error }) => {
      console.error("[chat] model hatası:", error);
      await saveAssistant("", [], 0, 0, error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500));
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      generateMessageId: () => assistantId,
      sendReasoning: false,
      onError: () => config.fallbackMessage,
    }),
  });
}
