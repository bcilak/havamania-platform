import { bridgeJson } from "@/lib/bridge/errors";
import { withBridge } from "@/lib/bridge/guard";
import { loadConsent } from "@/lib/consent-server";

export const runtime = "nodejs";

/**
 * Güncel açık rıza metni (yer tutucuları doldurulmuş) ve sürümü. Widget ile aynı kaynaktan gelir.
 * `health`: sağlık verisi için ayrı, isteğe bağlı rıza (kendi metni ve sürümü); yalnızca eklenmiş alandır.
 */
export async function GET(request: Request) {
  return withBridge(request, async () => {
    const c = await loadConsent();
    return bridgeJson({ version: c.version, text: c.text, updated_at: c.updatedAt, health: c.health });
  });
}
