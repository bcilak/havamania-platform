import type { ToolId } from "@/lib/bot-config";

/** Canlı testte gönderilen örnek parametreler. */
export const SAMPLE: Record<ToolId, Record<string, string>> = {
  current_weather: { q: "Balıkesir" },
  forecast: { q: "İzmir", days: "3" },
  agro_conditions: { q: "Konya", crop: "buğday", days: "5" },
  flight_weather: { origin: "LTFM", destination: "LTAC", flightLevel: "350" },
};

/** Asistanın araç çağrısında gerçekte gönderdiği parametreler (tools.ts ile aynı olmalı). */
export const SENT_PARAMS: Record<ToolId, string> = {
  current_weather: "q (şehir/ilçe adı) ya da lat ve lon (cihaz konumu)",
  forecast: "q ya da lat ve lon; days",
  agro_conditions: "q ya da lat ve lon; crop, days",
  flight_weather: "origin, destination; flightLevel, departureTime (isteğe bağlı)",
};
