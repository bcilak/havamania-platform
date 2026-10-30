import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bridgeUsage } from "@/db/schema";

/**
 * Bot için bugünkü köprü mesaj sayacını tek atomik sorguyla bir artırır; tavan doluysa artırmaz.
 * Alınan günü (`YYYY-MM-DD`, Europe/Istanbul) döner; tavan doluysa null. Sayaç konuşma/mesaj tablolarından
 * bağımsızdır, silmeyle sıfırlanmaz. Model çağrılmadan biten istek `releaseBridgeDailySlot` ile iade edilir;
 * model hatası ya da zaman aşımı geri sayılmaz (sağlayıcıya gidilmiş olabilir; tavan maliyet içindir).
 */
export async function takeBridgeDailySlot(botId: string, cap: number): Promise<string | null> {
  const today = sql`(now() at time zone 'Europe/Istanbul')::date`;
  const rows = await db
    .insert(bridgeUsage)
    .values({ botId, day: today, messages: 1 })
    .onConflictDoUpdate({
      target: [bridgeUsage.botId, bridgeUsage.day],
      set: { messages: sql`${bridgeUsage.messages} + 1` },
      setWhere: sql`${bridgeUsage.messages} < ${cap}`,
    })
    .returning({ day: bridgeUsage.day });
  return rows[0]?.day ?? null;
}

/** `takeBridgeDailySlot`un aldığı slotu geri verir (0'ın altına inmez). Gün dönse bile alındığı güne yazılır. */
export async function releaseBridgeDailySlot(botId: string, day: string): Promise<void> {
  await db
    .update(bridgeUsage)
    .set({ messages: sql`greatest(${bridgeUsage.messages} - 1, 0)` })
    .where(and(eq(bridgeUsage.botId, botId), eq(bridgeUsage.day, day)));
}
