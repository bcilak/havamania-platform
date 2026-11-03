import { migrateLanding } from "./migrate";
import { defaultLandingContent, landingSchema, type LandingContent } from "./schema";

/*
 * Kayıtlı landing içeriğini şemaya göre doğrular; eksik alanları varsayılandan tamamlar.
 * Veritabanına bağlı değildir (store.ts bunu kullanır), bu yüzden birim testi yazılabilir.
 */

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function coerce(raw: unknown): LandingContent {
  const d = defaultLandingContent();
  if (!isObj(raw)) return d;
  // Üst düzeyin yanı sıra ikinci düzey de varsayılanla birleşir: eski bir kayıtta sonradan
  // eklenmiş bir alan yoksa tüm içerik varsayılana düşmesin. Kayıttaki null/undefined anahtar
  // da yok sayılır, varsayılandan dolar. Kayıttaki şemada olmayan anahtarlar (eski
  // scenes.agro/fly, phase2) burada hiç alınmaz; şema zaten atardı.
  const merged: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(d)) {
    const r = raw[k];
    if (r === null || r === undefined) merged[k] = def;
    else merged[k] = isObj(def) && isObj(r) ? { ...def, ...r } : r;
  }
  const parsed = landingSchema.safeParse(merged);
  if (parsed.success) return migrateLanding(parsed.data);
  // Sessiz düşüş görünür olsun: yalnızca alan yolu loglanır, değer loglanmaz.
  console.error("[cms] landing içeriği şemaya uymadı", parsed.error.issues[0]?.path.join("."));
  return d;
}
