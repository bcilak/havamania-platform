import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { getAdmin } from "@/lib/auth";
import { can } from "@/lib/roles";

/** Test alanının cevap altındaki ayrıntı paneli için. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin || !can(admin.role, "conversations")) return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bulunamadı." }, { status: 404 });
  const [m] = await db.select().from(messages).where(eq(messages.id, id));
  if (!m) return NextResponse.json({ error: "Bulunamadı." }, { status: 404 });
  return NextResponse.json({
    model: m.model,
    latencyMs: m.latencyMs,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    costUsd: m.costUsd,
    unanswered: m.unanswered,
    error: m.error,
    sources: m.sources,
    toolCalls: m.toolCalls,
  });
}
