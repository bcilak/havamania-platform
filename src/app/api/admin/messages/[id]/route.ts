import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getAdmin } from "@/lib/auth";
import { HEALTH_RESTRICTED_NOTICE, healthRestricted, maskToolPayload, piiText } from "@/lib/pii-mask";
import { can } from "@/lib/roles";

/** Test alanının cevap altındaki ayrıntı paneli için. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin || !can(admin.role, "conversations")) return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bulunamadı." }, { status: 404 });
  const [row] = await db
    .select({ m: messages, healthContext: conversations.healthContext })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(eq(messages.id, id));
  if (!row) return NextResponse.json({ error: "Bulunamadı." }, { status: 404 });
  const m = row.m;
  // pii yetkisi olmayan rol (destek) sorgu, hata ve araç girdi/çıktısını maskeli alır.
  const pii = can(admin.role, "pii");
  // Sağlık bilgisi içerebilen konuşmada yetkisiz rol içeriğe (sorgu, hata, araç girdisi/çıktısı, kaynak parçaları) hiç erişmez.
  if (healthRestricted(pii, row.healthContext)) {
    return NextResponse.json({
      restricted: true,
      notice: HEALTH_RESTRICTED_NOTICE,
      model: m.model,
      latencyMs: m.latencyMs,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      costUsd: m.costUsd,
      unanswered: m.unanswered,
      error: null,
      sources: [],
      searchQuery: null,
      embeddingTokens: m.embeddingTokens,
      embeddingCostUsd: m.embeddingCostUsd,
      toolCalls: [],
    });
  }
  return NextResponse.json({
    model: m.model,
    latencyMs: m.latencyMs,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    costUsd: m.costUsd,
    unanswered: m.unanswered,
    error: m.error ? piiText(pii, m.error) : m.error,
    sources: m.sources,
    searchQuery: m.searchQuery ? piiText(pii, m.searchQuery) : m.searchQuery,
    embeddingTokens: m.embeddingTokens,
    embeddingCostUsd: m.embeddingCostUsd,
    toolCalls: pii ? m.toolCalls : (maskToolPayload(m.toolCalls) as typeof m.toolCalls),
  });
}
