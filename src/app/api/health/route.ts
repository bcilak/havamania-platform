import { NextResponse } from "next/server";
import { sqlClient } from "@/db";

export const dynamic = "force-dynamic";

/** Yük dengeleyici ve Docker HEALTHCHECK için: uygulama ve veritabanı ayakta mı? */
export async function GET() {
  try {
    await sqlClient`select 1`;
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Veritabanına ulaşılamıyor." }, { status: 503 });
  }
}
