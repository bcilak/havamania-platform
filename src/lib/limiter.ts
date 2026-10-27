/** Kuyruk dolu ya da bekleme süresi aşıldı: iş çalıştırılmadı, çağıran 503 gibi bir "meşgul" yanıtı dönmeli. */
export class LimiterBusyError extends Error {
  constructor(public reason: "queue_full" | "timeout") {
    super(`Sınırlayıcı meşgul: ${reason}`);
    this.name = "LimiterBusyError";
  }
}

type Waiter = { grant: () => void; timer: ReturnType<typeof setTimeout> | undefined };

/**
 * Aynı anda en çok `max` işlem çalıştıran basit bellek içi sınır; fazlası sıraya girer.
 * `maxQueue`: bekleyen üst sınırı (dolunca `LimiterBusyError("queue_full")`); `waitMs`: sırada en uzun bekleme
 * (aşılınca `LimiterBusyError("timeout")`). İkisi de verilmezse kuyruk sınırsız ve bekleme süresizdir.
 */
export function createLimiter(max: number, opts: { maxQueue?: number; waitMs?: number } = {}) {
  const maxQueue = opts.maxQueue ?? Infinity;
  let active = 0;
  const waiting: Waiter[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      if (waiting.length >= maxQueue) throw new LimiterBusyError("queue_full");
      await new Promise<void>((resolve, reject) => {
        const w: Waiter = { grant: resolve, timer: undefined };
        if (opts.waitMs !== undefined) {
          w.timer = setTimeout(() => {
            const i = waiting.indexOf(w);
            if (i >= 0) waiting.splice(i, 1);
            reject(new LimiterBusyError("timeout"));
          }, opts.waitMs);
        }
        waiting.push(w);
      });
    } else active++;
    try {
      return await task();
    } finally {
      // Yuvayı bekleyene devret (active sayısı değişmez); bekleyen yoksa yuvayı bırak.
      const next = waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        next.grant();
      } else active--;
    }
  };
}
