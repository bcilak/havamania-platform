import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ToolId } from "@/lib/bot-config";
import { callHavamaniaApi } from "./havamania-api";

export type UserLocation = { lat: number; lon: number; name?: string } | null | undefined;

const place = {
  location: z.string().optional().describe("Şehir/ilçe adı. Kullanıcı belirtmediyse boş bırak; cihaz konumu kullanılır."),
};

export function buildTools(enabled: ToolId[], ctx: { location: UserLocation }): ToolSet {
  const loc = (name?: string) =>
    name ? { q: name } : ctx.location ? { lat: ctx.location.lat, lon: ctx.location.lon } : { q: undefined };

  const all: Record<ToolId, ToolSet[string]> = {
    current_weather: tool({
      description: "Bir konumdaki anlık hava durumunu getirir: sıcaklık, hissedilen, nem, rüzgâr, UV, görüş, basınç.",
      inputSchema: z.object(place),
      execute: async ({ location }) => callHavamaniaApi("current_weather", loc(location)),
    }),
    forecast: tool({
      description: "Saatlik ve günlük tahmin: sıcaklık, yağış olasılığı, rüzgâr. En fazla 7 gün.",
      inputSchema: z.object({ ...place, days: z.number().int().min(1).max(7).default(3) }),
      execute: async ({ location, days }) => callHavamaniaApi("forecast", { ...loc(location), days }),
    }),
    agro_conditions: tool({
      description:
        "Tarım koşulları: don riski, toprak nemi, buharlaşma (ETo), ilaçlama ve hasat için uygun zaman pencereleri.",
      inputSchema: z.object({
        ...place,
        crop: z.string().optional().describe("Ürün, örneğin buğday, domates, zeytin."),
        days: z.number().int().min(1).max(7).default(5),
      }),
      execute: async ({ location, crop, days }) => callHavamaniaApi("agro_conditions", { ...loc(location), crop, days }),
    }),
    flight_weather: tool({
      description: "Uçuş rotası hava durumu: seviye bazında türbülans, rüzgâr, jet akımı, buzlanma ve bulut tabanı.",
      inputSchema: z.object({
        origin: z.string().describe("Kalkış meydanı, ICAO veya IATA kodu (örn. LTFM, IST)."),
        destination: z.string().describe("Varış meydanı, ICAO veya IATA kodu."),
        flightLevel: z.number().int().min(10).max(510).optional().describe("Planlanan seviye, örn. 350."),
        departureTime: z.string().optional().describe("ISO 8601 kalkış zamanı."),
      }),
      execute: async (input) => callHavamaniaApi("flight_weather", input),
    }),
  };

  return Object.fromEntries(enabled.filter((id) => id in all).map((id) => [id, all[id]]));
}
