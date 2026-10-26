import type { ProviderModel } from "@/db/schema";
import type { BotConfig } from "@/lib/bot-config";

/**
 * Sağlayıcının model listesinde olmayan model için varsayılan yetenekler:
 * görsel ve araç desteği bilinmediği için kapalı kabul edilir (elle işaretlenene kadar).
 */
export function modelMetaOrDefault(models: ProviderModel[], modelId: string): ProviderModel {
  return (
    models.find((m) => m.id === modelId) ?? {
      id: modelId,
      label: modelId,
      vision: false,
      tools: false,
      inputPer1M: 0,
      outputPer1M: 0,
    }
  );
}

export type ModelProblem = { mode: string; label: string; reason: "unset" | "provider" | "model" };

export const MODEL_PROBLEM_TEXT: Record<ModelProblem["reason"], string> = {
  unset: "model seçilmemiş",
  provider: "seçili sağlayıcı silinmiş",
  model: "seçili model sağlayıcının listesinde yok",
};

/**
 * Açık modların modeli kullanılabilir mi: sağlayıcı duruyor ve model listesinde mi.
 * `includeUnset` false ise hiç model seçilmemiş modlar sayılmaz (eski sürüme dönüşte).
 */
export function missingModels(
  config: Pick<BotConfig, "modes">,
  providers: { id: string; models: { id: string }[] }[],
  opts: { includeUnset: boolean },
): ModelProblem[] {
  const out: ModelProblem[] = [];
  for (const [mode, m] of Object.entries(config.modes)) {
    if (!m.enabled) continue;
    if (!m.providerId || !m.model) {
      if (opts.includeUnset) out.push({ mode, label: m.label, reason: "unset" });
      continue;
    }
    const provider = providers.find((p) => p.id === m.providerId);
    if (!provider) out.push({ mode, label: m.label, reason: "provider" });
    else if (!provider.models.some((x) => x.id === m.model)) out.push({ mode, label: m.label, reason: "model" });
  }
  return out;
}
