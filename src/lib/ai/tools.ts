import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ToolId } from "@/lib/bot-config";
import { callHavamaniaApi, type ApiResult } from "./havamania-api";
import { apiFailure, locationParams } from "./havamania-api-core";
import type { UserLocation } from "./location";
import { wrapToolOutput } from "./prompt";

export type { UserLocation };

const place = {
  location: z.string().max(80).optional().describe("Şehir/ilçe adı. Kullanıcı belirtmediyse boş bırak; cihaz konumu kullanılır."),
};

// Ham çıktı istemciye/veritabanına olduğu gibi gider; modele ise "veri" sınırlayıcısıyla verilir.
const forModel = (name: string) => ({ output }: { output: unknown }) => ({ type: "text" as const, value: wrapToolOutput(name, output) });

export function buildTools(enabled: ToolId[], ctx: { location: UserLocation }): ToolSet {
  // Konum ne araç girdisinde ne cihazda varsa istek atılmaz; model kullanıcıya sorar.
  const withLocation = (name: string | undefined, call: (loc: NonNullable<ReturnType<typeof locationParams>>) => Promise<ApiResult>): Promise<ApiResult> => {
    const loc = locationParams(name, ctx.location);
    return loc ? call(loc) : Promise.resolve(apiFailure("no_location"));
  };

  const all: Record<ToolId, ToolSet[string]> = {
    current_weather: tool({
      description: "Bir konumdaki anlık hava durumunu getirir: sıcaklık, hissedilen, nem, rüzgâr, UV, görüş, basınç.",
      inputSchema: z.object(place),
      execute: async ({ location }) => withLocation(location, (loc) => callHavamaniaApi("current_weather", loc)),
      toModelOutput: forModel("current_weather"),
    }),
    forecast: tool({
      description: "Saatlik ve günlük tahmin: sıcaklık, yağış olasılığı, rüzgâr. En fazla 7 gün.",
      inputSchema: z.object({ ...place, days: z.number().int().min(1).max(7).default(3) }),
      execute: async ({ location, days }) => withLocation(location, (loc) => callHavamaniaApi("forecast", { ...loc, days })),
      toModelOutput: forModel("forecast"),
    }),
    agro_conditions: tool({
      description:
        "Tarım koşulları: don riski, toprak nemi, buharlaşma (ETo), ilaçlama ve hasat için uygun zaman pencereleri.",
      inputSchema: z.object({
        ...place,
        crop: z.string().max(60).optional().describe("Ürün, örneğin buğday, domates, zeytin."),
        days: z.number().int().min(1).max(7).default(5),
      }),
      execute: async ({ location, crop, days }) => withLocation(location, (loc) => callHavamaniaApi("agro_conditions", { ...loc, crop, days })),
      toModelOutput: forModel("agro_conditions"),
    }),
    flight_weather: tool({
      description: "Uçuş rotası hava durumu: seviye bazında türbülans, rüzgâr, jet akımı, buzlanma ve bulut tabanı.",
      inputSchema: z.object({
        origin: z.string().max(10).describe("Kalkış meydanı, ICAO veya IATA kodu (örn. LTFM, IST)."),
        destination: z.string().max(10).describe("Varış meydanı, ICAO veya IATA kodu."),
        flightLevel: z.number().int().min(10).max(510).optional().describe("Planlanan seviye, örn. 350."),
        departureTime: z.string().max(40).optional().describe("ISO 8601 kalkış zamanı."),
      }),
      execute: async (input) => callHavamaniaApi("flight_weather", input),
      toModelOutput: forModel("flight_weather"),
    }),
  };

  return Object.fromEntries(enabled.filter((id) => id in all).map((id) => [id, all[id]]));
}
