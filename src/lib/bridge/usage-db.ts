import { sql } from "drizzle-orm";
import { db } from "@/db";
import { bridgeUsage } from "@/db/schema";

/**
 * Bot için bugünkü köprü mesaj sayacını tek atomik sorguyla bir artırır; tavan doluysa artırmaz.
 * true: istek geçebilir. Sayaç konuşma/mesaj tablolarından bağımsızdır, silmeyle sıfırlanmaz.
 * Model hatası ya da zaman aşımı mesajı geri sayılmaz (sağlayıcıya gidilmiş olabilir; tavan maliyet içindir).
 */
export async function takeBridgeDailySlot(botId: string, cap: number): Promise<boolean> {
  const today = sql`(now() at time zone 'Europe/Istanbul')::date`;
  const rows = await db
    .insert(bridgeUsage)
    .values({ botId, day: today, messages: 1 })
    .onConflictDoUpdate({
      target: [bridgeUsage.botId, bridgeUsage.day],
      set: { messages: sql`${bridgeUsage.messages} + 1` },
      setWhere: sql`${bridgeUsage.messages} < ${cap}`,
    })
    .returning({ messages: bridgeUsage.messages });
  return rows.length > 0;
}
