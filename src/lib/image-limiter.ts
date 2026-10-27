import { createLimiter } from "./limiter";

/*
 * Görsel işleme (sharp çözme/yeniden kodlama) için TEK paylaşılan sınır: yükleme, /api/files, modele gönderim (turn.ts)
 * ve geçiş betiği aynı modülden geçer. En çok 2 eşzamanlı iş, en çok 16 bekleyen, en çok 10 sn bekleme;
 * aşılırsa LimiterBusyError (çağıran 503 + Retry-After döner ya da dosyayı atlar).
 * Next.js route'ları ayrı paketlenebildiği için örnek globalThis üzerinde tutulur.
 */
export const IMAGE_QUEUE = { concurrency: 2, maxQueue: 16, waitMs: 10_000 };

const KEY = Symbol.for("havamania.imageLimiter");
type Run = ReturnType<typeof createLimiter>;
const g = globalThis as unknown as Record<symbol, Run | undefined>;
export const runImageWork: Run = (g[KEY] ??= createLimiter(IMAGE_QUEUE.concurrency, { maxQueue: IMAGE_QUEUE.maxQueue, waitMs: IMAGE_QUEUE.waitMs }));

/** Meşgul yanıtındaki Retry-After (saniye). */
export const IMAGE_RETRY_AFTER = "5";
