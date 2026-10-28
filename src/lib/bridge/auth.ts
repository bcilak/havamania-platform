import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bridgeKeys } from "@/db/schema";
import { hashBridgeKey, matchKey, parseBearer } from "./keys-core";

/*
 * Köprü isteklerinin kimliği. Etkin anahtar özetleri süreç içinde önbelleklenir (tek örnek
 * varsayımı, `rate-limit.ts` ile aynı): iptal en geç TTL kadar gecikebilir. Anahtar, başlık
 * ve özet hiçbir zaman loglanmaz.
 */

type ActiveKey = { id: string; botId: string; keyHash: string; hint: string };
type Cache = { keys: ActiveKey[]; loadedAt: number };

const TTL_MS = 30_000;
/** Bilinmeyen bir anahtar geldiğinde listeyi yeniden yüklemek için son yüklemeden bu yana geçmesi gereken süre. */
const RELOAD_MIN_MS = 5_000;
const TOUCH_MIN_MS = 5 * 60_000;

// Server action (anahtar oluştur/iptal et) ve route handler farklı modül örneklerinde çalışabilir; durum globalThis'te tutulur.
const g = globalThis as unknown as { __hmBridge?: { cache: Cache | null; loading: Promise<Cache> | null; gen: number; touched: Map<string, number> } };
const state = (g.__hmBridge ??= { cache: null, loading: null, gen: 0, touched: new Map() });

async function load(): Promise<Cache> {
  const gen = state.gen;
  const rows = await db
    .select({ id: bridgeKeys.id, botId: bridgeKeys.botId, keyHash: bridgeKeys.keyHash, hint: bridgeKeys.hint })
    .from(bridgeKeys)
    .where(isNull(bridgeKeys.revokedAt));
  const fresh: Cache = { keys: rows, loadedAt: Date.now() };
  // Yükleme sürerken önbellek geçersiz kılındıysa (anahtar iptali) bu sonuç eski olabilir; saklanmaz.
  if (gen === state.gen) state.cache = fresh;
  return fresh;
}

function activeKeys(forceReload: boolean): Promise<Cache> {
  const c = state.cache;
  if (!forceReload && c && Date.now() - c.loadedAt < TTL_MS) return Promise.resolve(c);
  state.loading ??= load().finally(() => {
    state.loading = null;
  });
  return state.loading;
}

/** Anahtar oluşturulduktan ya da iptal edildikten sonra çağrılır; sonraki istek listeyi yeniden yükler. */
export function invalidateBridgeKeyCache() {
  state.gen++;
  state.cache = null;
  state.loading = null;
}

/** `last_used_at` en çok 5 dakikada bir yazılır; bekletilmez, hatası yutulur. */
function touch(keyId: string) {
  const now = Date.now();
  if (now - (state.touched.get(keyId) ?? 0) < TOUCH_MIN_MS) return;
  state.touched.set(keyId, now);
  db.update(bridgeKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(bridgeKeys.id, keyId), or(isNull(bridgeKeys.lastUsedAt), lt(bridgeKeys.lastUsedAt, sql`now() - interval '5 min'`))))
    .then(
      () => {},
      () => {},
    );
}

export type BridgeAuth = { keyId: string; botId: string; hint: string };

/** Geçerli bir anahtar yoksa null. Başlık biçimi hatalıysa veritabanına hiç gidilmez. */
export async function authenticateBridge(request: Request): Promise<BridgeAuth | null> {
  const key = parseBearer(request.headers.get("authorization"));
  if (!key) return null;
  const hash = hashBridgeKey(key);
  const first = await activeKeys(false);
  let hit = matchKey(hash, first.keys);
  // Biçimi doğru ama bilinmeyen anahtar: yeni oluşturulmuş olabilir; listeyi (en çok bir kez, 5 sn sınırıyla) yeniden yükle.
  if (!hit && Date.now() - first.loadedAt >= RELOAD_MIN_MS) hit = matchKey(hash, (await activeKeys(true)).keys);
  if (!hit) return null;
  touch(hit.id);
  return { keyId: hit.id, botId: hit.botId, hint: hit.hint };
}
