"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { TOOLS, type ToolId } from "@/lib/bot-config";
import { encrypt } from "@/lib/crypto";
import { bool, done, fail, num, str } from "@/lib/form";
import { getSetting, setSetting } from "@/lib/settings";

const BACK = "/admin/ayarlar/entegrasyon";

export async function saveIntegration(fd: FormData) {
  const admin = await requireAdmin("integration");
  const prev = await getSetting("integration");
  const baseUrl = str(fd, "baseUrl", 500).replace(/\/$/, "");
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error();
    } catch {
      fail(BACK, "Geçerli bir temel adres girin (https://…).");
    }
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
