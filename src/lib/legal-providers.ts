import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { providers } from "@/db/schema";
import { MODES } from "./bot-config";
import { getMainBot, getPublishedVersion } from "./bot";
import { formatAiProviders } from "./legal";
import { getSetting } from "./settings";

/**
 * `{{yz_saglayicilar}}` değeri: yayındaki sürümün modlarında seçili sağlayıcılar ve embedding sağlayıcısı.
 * Yayın ya da sağlayıcı yoksa yedek ifade döner; sayfa hiçbir zaman bu yüzden bozulmaz.
 */
export async function aiProviderList(): Promise<string> {
  try {
    const ids = new Set<string>();
    const bot = await getMainBot();
    const version = await getPublishedVersion(bot);
    if (version) {
      for (const m of MODES) {
        const mode = version.config.modes[m];
        if (mode.enabled && mode.providerId) ids.add(mode.providerId);
      }
    }
    const emb = await getSetting("embedding");
    if (emb.providerId) ids.add(emb.providerId);
    if (!ids.size) return formatAiProviders([]);
    const rows = await db.select({ kind: providers.kind, name: providers.name }).from(providers).where(inArray(providers.id, [...ids]));
    return formatAiProviders(rows);
  } catch {
    return formatAiProviders([]);
  }
}
