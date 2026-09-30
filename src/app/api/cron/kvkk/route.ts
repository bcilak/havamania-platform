import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { runRetentionCleanup } from "@/lib/kvkk";
import { getSetting, setSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";

/** Günlük zamanlanmış görev: Authorization: Bearer $CRON_SECRET */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || !given || !safeEqual(given, secret)) return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
  const cfg = await getSetting("kvkk");
  const result = await runRetentionCleanup(cfg.retentionDays);
  await setSetting("kvkk", { ...cfg, lastCleanupAt: new Date().toISOString() });
  await audit(null, "kvkk.cleanup", "cron", result);
  return NextResponse.json({ ok: true, ...result });
}
