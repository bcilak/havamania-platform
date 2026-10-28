import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { BotConfig } from "@/lib/bot-config";
import type { LandingContent } from "@/lib/cms/schema";

/* ---------- Özel tipler ---------- */

// Boyutsuz vector: embedding modeli değişince tablo şeması değişmesin diye.
// Hangi modelle üretildiği `embeddingModel` sütununda tutulur; arama yalnızca
// aynı modelle üretilmiş vektörler arasında yapılır.
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return value.slice(1, -1).split(",").map(Number);
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const created = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/* ---------- Tipler ---------- */

export type AdminRole = "super_admin" | "editor" | "trainer" | "support";
export type ChatMode = "genel" | "agro" | "fly";
export type Platform = "ios" | "android" | "web" | "playground";
export type ProviderKind = "anthropic" | "openai" | "google" | "openai_compatible";
export type KbSourceType = "file" | "url" | "qa" | "correction" | "cms";
export type KbStatus = "pending" | "processing" | "ready" | "failed";

export type ProviderModel = {
  id: string;
  label: string;
  vision: boolean;
  tools: boolean;
  /** 1 milyon token için USD. Maliyet takibi için; bilinmiyorsa 0 bırakılır. */
  inputPer1M: number;
  outputPer1M: number;
};

export type ToolCallRecord = {
  name: string;
  input: unknown;
  output: unknown;
};

export type SourceRecord = {
  sourceId: string;
  title: string;
  snippet: string;
  score: number;
  /** Aşağıdakiler yeni kayıtlarda dolu; eski kayıtlarda yok. */
  chunkId?: string;
  /** Kosinüs benzerliği; vektör araması yoksa null. */
  similarity?: number | null;
  lexical?: boolean;
  rank?: number;
  /** Cevapta [n] ile anılan kaynak (n = rank). Eski kayıtlarda yok. Son kullanıcıya gösterilmez; yalnızca panelde. */
  cited?: boolean;
};

/** Kayıtlı test senaryosunun beklenen ölçütleri (hepsi isteğe bağlı; deterministik kontrol). */
export type EvalExpect = {
  /** Cevapta geçmesi gereken ifadeler (Türkçe küçük harfe çevrilerek aranır). */
  mustInclude: string[];
  /** Cevapta geçmemesi gereken ifadeler. */
  mustNotInclude: string[];
  /** Araç adı ya da "any" (herhangi bir araç çağrılmalı). */
  expectTool?: string | null;
  /** İlgili kaynaklar arasında bulunması gereken kaynak kimliği. */
  expectSourceId?: string | null;
  /** true: cevapsız işaretlenmeli; false: cevaplı olmalı. */
  expectUnanswered?: boolean | null;
};

export type EvalCheck = { id: string; label: string; ok: boolean; detail?: string };
export type EvalRunStatus = "running" | "done" | "failed" | "cancelled";
/** Koşunun hedefi: "draft" | "published" | { versionId } (TurnTarget ile aynı biçim). */
export type EvalTarget = "draft" | "published" | { versionId: string };
export type EvalRunSummary = {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  /** Ölçütsüz (değerlendirilmeyen) senaryo sayısı. */
  unchecked: number;
  maxCostUsd: number;
  /** Çalıştırılmayan (maliyet sınırı ya da iptal) senaryo sayısı. */
  skipped: number;
  stoppedBy?: "cost" | "cancel" | null;
  /** Son ilerleme zamanı (ISO); yarıda kalan koşuyu ayırt etmek için. */
  lastActivityAt: string;
  error?: string | null;
};

/* ---------- Admin ---------- */

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<AdminRole>().notNull(),
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabled: boolean("totp_enabled").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: created(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    target: text("target"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: created(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

/* ---------- Ayarlar (anahtar/değer) ---------- */

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ---------- Model sağlayıcıları ---------- */

export const providers = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").$type<ProviderKind>().notNull(),
  name: text("name").notNull(),
  apiKeyEnc: text("api_key_enc"),
  baseUrl: text("base_url"),
  models: jsonb("models").$type<ProviderModel[]>().default([]).notNull(),
  embeddingModels: jsonb("embedding_models").$type<string[]>().default([]).notNull(),
  /** Embedding modeli → 1 milyon token için USD (maliyet takibi). Fiyatı girilmemiş model 0 sayılır. */
  embeddingPrices: jsonb("embedding_prices").$type<Record<string, number>>().default({}).notNull(),
  createdAt: created(),
});

/* ---------- Bot ve sürümler ---------- */

export const bots = pgTable("bots", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  publicKey: text("public_key").notNull().unique(),
  /** Uygulama backend'inin kullanıcı token'ı imzaladığı HMAC anahtarı (şifreli). */
  tokenSecretEnc: text("token_secret_enc"),
  allowAnonymous: boolean("allow_anonymous").default(true).notNull(),
  allowedOrigins: jsonb("allowed_origins").$type<string[]>().default([]).notNull(),
  draftConfig: jsonb("draft_config").$type<BotConfig>().notNull(),
  publishedVersionId: uuid("published_version_id"),
  createdAt: created(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const botVersions = pgTable(
  "bot_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .references(() => bots.id, { onDelete: "cascade" })
      .notNull(),
    number: integer("number").notNull(),
    config: jsonb("config").$type<BotConfig>().notNull(),
    /** Yayın anında hazır olan bilgi tabanı kaynakları. Yayındaki bot yalnızca bunlarda arar. */
    kbSourceIds: jsonb("kb_source_ids").$type<string[]>().default([]).notNull(),
    /**
     * Yayın anındaki embedding ayarı (sağlayıcı + model); sürümün sorgu vektörü bununla üretilir.
     * providerId null = o anda vektör araması kapalıydı. Sütun NULL ise (eski sürüm) güncel ayar kullanılır.
     */
    embedding: jsonb("embedding").$type<{ providerId: string | null; model: string | null }>(),
    note: text("note"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("bot_versions_bot_number_idx").on(t.botId, t.number)],
);

/**
 * Mobil backend (sunucudan sunucuya) köprüsünün anahtarları. Anahtarın kendisi saklanmaz,
 * yalnızca SHA-256 özeti tutulur; düz metin yalnızca oluşturulduğu anda bir kez gösterilir.
 * İptal edilen anahtar silinmez (`revokedAt`), denetim izi korunur.
 */
export const bridgeKeys = pgTable(
  "bridge_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .references(() => bots.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    /** SHA-256 (hex) */
    keyHash: text("key_hash").notNull().unique(),
    /** Anahtarın son 4 karakteri; listede tanımak için. */
    hint: text("hint").notNull(),
    createdBy: text("created_by"),
    createdAt: created(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
  },
  (t) => [index("bridge_keys_bot_idx").on(t.botId)],
);

/**
 * Köprü günlük mesaj sayacı (maliyet tavanı): bot ve gün (Europe/Istanbul takvim günü) başına bir satır.
 * Konuşma/mesaj tablolarından bağımsızdır: /delete-user ve saklama temizliği sayacı sıfırlayamaz. Kişisel veri
 * içermez (kullanıcı kimliği yok), yalnızca sayı tutar. Bot silinirse cascade ile gider.
 */
export const bridgeUsage = pgTable(
  "bridge_usage",
  {
    botId: uuid("bot_id")
      .references(() => bots.id, { onDelete: "cascade" })
      .notNull(),
    day: date("day").notNull(),
    messages: integer("messages").default(0).notNull(),
  },
  (t) => [primaryKey({ columns: [t.botId, t.day] })],
);

/* ---------- Bilgi tabanı ---------- */

export const kbSources = pgTable(
  "kb_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .references(() => bots.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").$type<KbSourceType>().notNull(),
    /** "all": tüm modlarda kullanılır. */
    mode: text("mode").$type<ChatMode | "all">().default("all").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<KbStatus>().default("pending").notNull(),
    error: text("error"),
    /** Kaynak kullanılabilir ama eksik bir işlem var (ör. vektörleme başarısız). */
    warning: text("warning"),
    /** Yumuşak silme: taslaktan çıkar, sürümlerde geçtiği sürece yayında kullanılır. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Yeniden işleme: bu satırın yerine geçen yeni satır (FK yok). */
    supersededBy: uuid("superseded_by"),
    storageKey: text("storage_key"),
    mediaType: text("media_type"),
    url: text("url"),
    question: text("question"),
    answer: text("answer"),
    charCount: integer("char_count").default(0).notNull(),
    chunkCount: integer("chunk_count").default(0).notNull(),
    embeddingModel: text("embedding_model"),
    /** Son işlemede vektörleme için harcanan token ve maliyet (USD); embedding kapalıysa boş. */
    embeddingTokens: integer("embedding_tokens"),
    embeddingCostUsd: numeric("embedding_cost_usd", { precision: 12, scale: 6, mode: "number" }),
    /** Düzeltmeler ve SSS aramada öne çıkar. */
    priority: integer("priority").default(0).notNull(),
    createdBy: text("created_by"),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("kb_sources_bot_idx").on(t.botId)],
);

/**
 * Vektörleme (embedding) maliyetinin olay kaydı: kaynak işlenirken ya da boşluk analizinde anlamsal birleştirme
 * yapıldığında bir satır eklenir, sonradan değişmez. Panoda maliyet olay anına göre döneme yazılır (kaynak
 * yeniden işlenince önceki maliyet silinmez). `kb_sources.embedding_*` yalnızca "son işlem" bilgisidir.
 * source_id'ye FK yoktur: kaynak kalıcı silinse de harcama kaydı kalır.
 */
export const kbEmbeddingUsage = pgTable(
  "kb_embedding_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .references(() => bots.id, { onDelete: "cascade" })
      .notNull(),
    sourceId: uuid("source_id"),
    /** ingest: kaynak işleme; gap_semantic: boşluk analizi anlamsal birleştirme. */
    kind: text("kind").$type<"ingest" | "gap_semantic">().default("ingest").notNull(),
    tokens: integer("tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull(),
    createdAt: created(),
  },
  (t) => [index("kb_embedding_usage_created_idx").on(t.createdAt), index("kb_embedding_usage_source_idx").on(t.sourceId)],
);

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .references(() => kbSources.id, { onDelete: "cascade" })
      .notNull(),
    botId: uuid("bot_id").notNull(),
    mode: text("mode").$type<ChatMode | "all">().notNull(),
    idx: integer("idx").notNull(),
    content: text("content").notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('turkish', coalesce(content, ''))`),
    embedding: vector("embedding"),
    embeddingModel: text("embedding_model"),
  },
  (t) => [
    index("kb_chunks_source_idx").on(t.sourceId),
    index("kb_chunks_bot_idx").on(t.botId),
    index("kb_chunks_tsv_idx").using("gin", t.tsv),
  ],
);

/* ---------- Uygulama kullanıcıları ve konuşmalar ---------- */

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .references(() => bots.id, { onDelete: "cascade" })
      .notNull(),
    deviceId: text("device_id").notNull(),
    externalUserId: text("external_user_id"),
    platform: text("platform").$type<Platform>().notNull(),
    appVersion: text("app_version"),
    locale: text("locale"),
    consentVersion: integer("consent_version"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    isDemo: boolean("is_demo").default(false).notNull(),
    firstSeenAt: created(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Kimlik = (bot, cihaz, uygulama kullanıcısı). Aynı telefonda hesap değişince
    // yeni bir kayıt açılır; bir kullanıcı diğerinin geçmişini göremez.
    // Postgres'te NULL'lar birbirinden farklı sayıldığı için anonim kayıtların
    // (externalUserId NULL) tekilliğini ayrı bir kısmi indeks sağlar.
    unique("app_users_identity").on(t.botId, t.deviceId, t.externalUserId),
    uniqueIndex("app_users_anon_identity").on(t.botId, t.deviceId).where(sql`${t.externalUserId} is null`),
    index("app_users_device_idx").on(t.botId, t.deviceId),
    index("app_users_external_idx").on(t.externalUserId),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    // İstemci üretir (useChat kimliği); sahipliği sunucu doğrular.
    id: uuid("id").primaryKey(),
    botId: uuid("bot_id")
      .references(() => bots.id, { onDelete: "cascade" })
      .notNull(),
    appUserId: uuid("app_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    mode: text("mode").$type<ChatMode>().notNull(),
    platform: text("platform").$type<Platform>().notNull(),
    versionNumber: integer("version_number"),
    title: text("title"),
    messageCount: integer("message_count").default(0).notNull(),
    photoCount: integer("photo_count").default(0).notNull(),
    negativeCount: integer("negative_count").default(0).notNull(),
    flagged: boolean("flagged").default(false).notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).default(0).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    // Sağlık hassasiyetleri (KVKK m. 6) bu konuşmada gerçekten prompt'a girdiyse true; cevaplar bu bilgiye dayanabilir.
    // pii yetkisi olmayan roller bu konuşmanın içeriğini görmez; eval/düzeltme kopyası alınamaz. Bir kez true olunca geri dönmez.
    healthContext: boolean("health_context").default(false).notNull(),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    startedAt: created(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("conversations_last_idx").on(t.lastMessageAt),
    index("conversations_user_idx").on(t.appUserId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls").$type<ToolCallRecord[]>().default([]).notNull(),
    sources: jsonb("sources").$type<SourceRecord[]>().default([]).notNull(),
    /** Bilgi tabanında karşılık yok ve araç kullanılmadı: eğitim fırsatı. */
    unanswered: boolean("unanswered").default(false).notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** Model + arama (sorgu embedding'i) maliyeti toplamı. */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }),
    /** Bilgi tabanı aramasında gerçekte kullanılan sorgu (takip sorularında önceki mesajla birleşir). */
    searchQuery: text("search_query"),
    /** Sorgu embedding'inin token sayısı ve maliyeti (cost_usd'nin içinde); vektör araması yapılmadıysa boş. */
    embeddingTokens: integer("embedding_tokens"),
    embeddingCostUsd: numeric("embedding_cost_usd", { precision: 12, scale: 6, mode: "number" }),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: created(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    // Pano sorguları dönemle süzer (created_at aralığı); rol de süzülürse (role, created_at).
    index("messages_created_idx").on(t.createdAt),
    index("messages_role_created_idx").on(t.role, t.createdAt),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    appUserId: uuid("app_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    storageKey: text("storage_key").notNull(),
    mediaType: text("media_type").notNull(),
    size: integer("size").notNull(),
    hidden: boolean("hidden").default(false).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    createdAt: created(),
  },
  (t) => [index("attachments_created_idx").on(t.createdAt)],
);

export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id")
    .references(() => messages.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  conversationId: uuid("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  status: text("status").$type<"open" | "resolved" | "dismissed">().default("open").notNull(),
  resolvedBy: text("resolved_by"),
  createdAt: created(),
});

export const corrections = pgTable("corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  mode: text("mode").$type<ChatMode | "all">().notNull(),
  question: text("question").notNull(),
  wrongAnswer: text("wrong_answer"),
  correctAnswer: text("correct_answer").notNull(),
  kbSourceId: uuid("kb_source_id").references(() => kbSources.id, { onDelete: "set null" }),
  createdBy: text("created_by"),
  createdAt: created(),
  /** Düzeltme sonradan düzenlendiyse (bilgi tabanı kaynak ayrıntısından). */
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  updatedBy: text("updated_by"),
});

export const deletionRequests = pgTable("deletion_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  identifierType: text("identifier_type").$type<"device" | "external_user">().notNull(),
  status: text("status").$type<"completed" | "not_found">().notNull(),
  deletedConversations: integer("deleted_conversations").default(0).notNull(),
  deletedPhotos: integer("deleted_photos").default(0).notNull(),
  note: text("note"),
  requestedBy: text("requested_by"),
  createdAt: created(),
});

/* ---------- Test senaryoları ve koşular (regresyon seti) ---------- */

/**
 * Kayıtlı test senaryosu. `question` konuşmadan kopyalanmışsa kişisel veri içerebilir;
 * kaynak mesaj/konuşma silinince senaryo bağımsız kalır (`set null`), `question` silinmez.
 * Koşular konuşma ve mesaj tablolarına yazmaz.
 */
export const evalCases = pgTable(
  "eval_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .references(() => bots.id, { onDelete: "cascade" })
      .notNull(),
    mode: text("mode").$type<ChatMode>().notNull(),
    question: text("question").notNull(),
    location: jsonb("location").$type<{ lat: number; lon: number; name?: string } | null>(),
    expect: jsonb("expect").$type<EvalExpect>().notNull(),
    note: text("note"),
    sourceMessageId: uuid("source_message_id").references(() => messages.id, { onDelete: "set null" }),
    createdBy: text("created_by"),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("eval_cases_bot_idx").on(t.botId, t.createdAt)],
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .references(() => bots.id, { onDelete: "cascade" })
      .notNull(),
    target: jsonb("target").$type<EvalTarget>().notNull(),
    versionNumber: integer("version_number"),
    status: text("status").$type<EvalRunStatus>().default("running").notNull(),
    startedBy: text("started_by"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    summary: jsonb("summary").$type<EvalRunSummary>(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }),
  },
  (t) => [
    index("eval_runs_bot_idx").on(t.botId, t.startedAt),
    // Bot başına aynı anda tek koşu (yarışta bile): ikinci "running" kaydı eklenemez.
    uniqueIndex("eval_runs_one_running_idx").on(t.botId).where(sql`${t.status} = 'running'`),
  ],
);

export const evalResults = pgTable(
  "eval_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .references(() => evalRuns.id, { onDelete: "cascade" })
      .notNull(),
    caseId: uuid("case_id").references(() => evalCases.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    mode: text("mode").$type<ChatMode>().notNull(),
    answer: text("answer").default("").notNull(),
    sources: jsonb("sources").$type<SourceRecord[]>().default([]).notNull(),
    toolCalls: jsonb("tool_calls").$type<ToolCallRecord[]>().default([]).notNull(),
    checks: jsonb("checks").$type<EvalCheck[]>().default([]).notNull(),
    /** null: senaryoda ölçüt yok, değerlendirilmedi. */
    passed: boolean("passed"),
    unanswered: boolean("unanswered").default(false).notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: created(),
  },
  (t) => [index("eval_results_run_idx").on(t.runId), index("eval_results_case_idx").on(t.caseId), index("eval_results_run_created_idx").on(t.runId, t.createdAt)],
);

/* ---------- CMS ---------- */

export const cmsDocuments = pgTable("cms_documents", {
  id: text("id").primaryKey(),
  draft: jsonb("draft").$type<LandingContent>().notNull(),
  published: jsonb("published").$type<LandingContent>(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: text("published_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  storageKey: text("storage_key").notNull(),
  filename: text("filename").notNull(),
  mediaType: text("media_type").notNull(),
  size: integer("size").notNull(),
  alt: text("alt"),
  uploadedBy: text("uploaded_by"),
  createdAt: created(),
});
