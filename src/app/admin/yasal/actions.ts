"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { usesToken } from "@/lib/consent";
import { bool, done, fail, str } from "@/lib/form";
import { LEGAL_BODY_DEFAULTS, LEGAL_PAGES, type LegalSlug } from "@/lib/legal";
import { getSetting, setSetting } from "@/lib/settings";

const BACK = "/admin/yasal";
const SLUGS = Object.keys(LEGAL_PAGES) as LegalSlug[];

export async function saveLegal(fd: FormData) {
  const admin = await requireAdmin("cms");
  const prev = await getSetting("legal");

  const email = str(fd, "email", 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail(BACK, "İletişim e-postası geçerli değil.");

  const next = {
    ...prev,
    company: str(fd, "company", 200) || prev.company,
    address: str(fd, "address", 400),
    email,
    hosting: str(fd, "hosting", 120) || prev.hosting,
  };
  const reset: LegalSlug[] = [];
  for (const slug of SLUGS) {
    if (bool(fd, `reset_${slug}`)) {
      next[slug] = LEGAL_BODY_DEFAULTS[slug];
      reset.push(slug);
      continue;
    }
    const body = str(fd, slug, 60000);
    if (body.length < 200) fail(BACK, `${LEGAL_PAGES[slug].title} metni çok kısa.`);
    next[slug] = body;
  }

  const changed = (["company", "address", "email", "hosting", ...SLUGS] as const).filter((k) => next[k] !== prev[k]);
  if (!changed.length) done(BACK, "Değişiklik yok.");
  next.updatedAt = new Date().toISOString().slice(0, 10);

  await setSetting("legal", next);
  await audit(admin, "legal.update", null, { changed, reset });

  // Onay metni {{sirket}} içeriyorsa şirket adı kullanıcıya gösterilen metni değiştirir: sürüm artar, herkes yeniden onaylar.
  // Aynısı ayrı sağlık rızası metni için de geçerlidir (kendi sürümü artar).
  let consentBumped = false;
  if (next.company !== prev.company) {
    const kvkk = await getSetting("kvkk");
    const main = usesToken(kvkk.consentText, "{{sirket}}");
    const health = usesToken(kvkk.healthConsentText, "{{sirket}}");
    if (main || health) {
      const consentVersion = main ? kvkk.consentVersion + 1 : kvkk.consentVersion;
      const healthConsentVersion = health ? kvkk.healthConsentVersion + 1 : kvkk.healthConsentVersion;
      await setSetting("kvkk", {
        ...kvkk,
        consentVersion,
        healthConsentVersion,
        consentUpdatedAt: main ? new Date().toISOString() : kvkk.consentUpdatedAt,
      });
      await audit(admin, "kvkk.update", null, { consentVersion, healthConsentVersion, reason: "company" });
      revalidatePath("/admin/ayarlar/kvkk");
      consentBumped = true;
    }
  }

  for (const slug of SLUGS) revalidatePath(LEGAL_PAGES[slug].path);
  revalidatePath(BACK);
  done(
    BACK,
    consentBumped
      ? "Kaydedildi ve yayınlandı. Şirket adı açık rıza metninde de geçtiği için onay sürümü arttı; kullanıcılar yeniden onay verecek."
      : "Kaydedildi ve yayınlandı. Son güncelleme tarihi bugün olarak değişti.",
  );
}
