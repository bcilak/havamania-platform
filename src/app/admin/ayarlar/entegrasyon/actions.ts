"use server";

import { revalidatePath } from "next/cache";
import { API_URL_REASONS, checkApiUrl } from "@/lib/ai/api-url-guard";
import { callHavamaniaApi } from "@/lib/ai/havamania-api";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { TOOLS, type ToolId } from "@/lib/bot-config";
import { encrypt } from "@/lib/crypto";
import { bool, done, fail, num, str } from "@/lib/form";
import { getSetting, setSetting } from "@/lib/settings";
import { SAMPLE } from "./samples";

const BACK = "/admin/ayarlar/entegrasyon";

export type TestState = { tool: ToolId; ok: boolean; code?: string; body: string } | null;

/** Canlı test: kayıtlı ayarlarla örnek parametrelerle gerçek bir istek atar (POST; sayfa yüklemesi istek tetiklemez). */
export async function testIntegration(_prev: TestState, fd: FormData): Promise<TestState> {
  await requireAdmin("integration");
  const tool = str(fd, "test", 40);
  if (!Object.hasOwn(TOOLS, tool)) return { tool: "current_weather", ok: false, body: "Geçersiz araç." };
  const id = tool as ToolId;
  const result = await callHavamaniaApi(id, SAMPLE[id]);
  const body = JSON.stringify(result.ok ? result.data : result.error, null, 2) ?? "";
  return { tool: id, ok: result.ok, code: result.ok ? undefined : result.code, body: body.slice(0, 4000) };
}

export async function saveIntegration(fd: FormData) {
  const admin = await requireAdmin("integration");
  const prev = await getSetting("integration");
  const baseUrl = str(fd, "baseUrl", 500).replace(/\/$/, "");
  if (baseUrl) {
    let u: URL | null = null;
    try {
      u = new URL(baseUrl);
      if (!["http:", "https:"].includes(u.protocol)) u = null;
    } catch {
      u = null;
    }
    if (!u) fail(BACK, "Geçerli bir temel adres girin (https://…).");
    // https zorunlu, iç ağ/metadata adresleri engelli; yalnızca yerel test gevşetmesi (ALLOW_LOCAL_TARGETS) loopback'i açar.
    const check = await checkApiUrl(u!);
    if (!check.ok) fail(BACK, API_URL_REASONS[check.reason]);
  }
  const apiKey = str(fd, "apiKey", 1000);
  const endpoints = { ...prev.endpoints };
  for (const t of Object.keys(TOOLS) as ToolId[]) {
    const v = str(fd, `endpoint_${t}`, 300);
    if (v) endpoints[t] = v.startsWith("/") ? v : `/${v}`;
  }
  await setSetting("integration", {
    baseUrl,
    apiKeyEnc: bool(fd, "clearKey") ? null : apiKey ? encrypt(apiKey) : prev.apiKeyEnc,
    authHeader: str(fd, "authHeader", 60) || "Authorization",
    endpoints,
    timeoutMs: num(fd, "timeoutMs", 8000, 1000, 30000),
  });
  await audit(admin, "integration.update", null, { baseUrl });
  revalidatePath(BACK);
  done(BACK, "Kaydedildi.");
}
