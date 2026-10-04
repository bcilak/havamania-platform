"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
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
  for (const slug of SLUGS) revalidatePath(LEGAL_PAGES[slug].path);
  revalidatePath(BACK);
  done(BACK, `Kaydedildi ve yayınlandı. Son güncelleme tarihi bugün olarak değişti.`);
}
