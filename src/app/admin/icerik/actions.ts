"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { cmsDocuments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { getLanding, getLandingDoc, LANDING_ID } from "@/lib/cms/store";
import { landingSchema, type LandingContent, type SceneKey } from "@/lib/cms/schema";
import { describeIssue, type Issue } from "@/lib/cms/issue";
import { done, fail, formToObject, str } from "@/lib/form";

const BACK = "/admin/icerik";

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []).filter(Boolean) as Obj[];
/** Madde listesi: dizi ya da {0:…,1:…} nesnesini düz metne çevirir, kırpar, boş satırları atar. */
const strList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
/** Başlığı ya da metni dolu olan kartlar kalır; boş satırlar gösterilmez. */
const filled = (v: unknown): Obj[] => arr(v).filter((c) => c.title || c.text);

function sceneFrom(fd: FormData): LandingContent["scenes"][SceneKey] {
  const raw = formToObject(fd, "scene") as Obj;
  const s2 = (raw.screen2 ?? {}) as Obj;
  const s3 = (raw.screen3 ?? {}) as Obj;
  const s1 = (raw.screen1 ?? {}) as Obj;
  return {
    captions: arr(raw.captions),
    chips: arr(raw.chips),
    screen1: { ...s1, slots: arr(s1.slots) },
    screen2: {
      ...s2,
      ringPercent: Math.max(0, Math.min(100, Number(s2.ringPercent) || 0)),
      cards: arr(s2.cards).filter((c) => c.title || c.text),
    },
    screen3: { ...s3, bubbles: arr(s3.bubbles).filter((b) => b.text) },
  } as unknown as LandingContent["scenes"][SceneKey];
}

export async function saveSection(fd: FormData) {
  const admin = await requireAdmin("cms");
  const section = str(fd, "section");
  const back = `${BACK}?bolum=${section}`;
  const draft = await getLanding("draft");
  const next: LandingContent = structuredClone(draft);

  if (section === "genel") {
    next.seo = formToObject(fd, "seo") as LandingContent["seo"];
    next.nav = formToObject(fd, "nav") as LandingContent["nav"];
    next.hero = formToObject(fd, "hero") as LandingContent["hero"];
  } else if (section === "core") {
    next.scenes.core = sceneFrom(fd);
  } else if (section === "seyahat") {
    const route = formToObject(fd, "route") as Obj;
    const sample = (route.sample ?? {}) as Obj;
    const features = formToObject(fd, "features") as Obj;
    next.route = {
      ...route,
      bullets: strList(route.bullets),
      sample: { ...sample, stops: arr(sample.stops) },
    } as unknown as LandingContent["route"];
    next.features = { ...features, items: filled(features.items) } as unknown as LandingContent["features"];
    next.agroCard = formToObject(fd, "agroCard") as LandingContent["agroCard"];
  } else if (section === "enerji") {
    const energy = formToObject(fd, "energy") as Obj;
    const card = (v: unknown) => {
      const o = (v ?? {}) as Obj;
      return { ...o, data: strList(o.data), uses: strList(o.uses), benefits: strList(o.benefits) };
    };
    next.energy = { ...energy, solar: card(energy.solar), wind: card(energy.wind) } as unknown as LandingContent["energy"];
  } else if (section === "ucus") {
    const av = formToObject(fd, "aviation") as Obj;
    next.aviation = { ...av, analyses: filled(av.analyses), uses: strList(av.uses) } as unknown as LandingContent["aviation"];
  } else if (section === "yol") {
    const rm = formToObject(fd, "roadmap") as Obj;
    next.roadmap = { ...rm, phases: arr(rm.phases) } as unknown as LandingContent["roadmap"];
    next.earlyAccess = formToObject(fd, "earlyAccess") as LandingContent["earlyAccess"];
  } else if (section === "asistan") {
    next.assistant = formToObject(fd, "assistant") as LandingContent["assistant"];
  } else if (section === "premium") {
    const p = formToObject(fd, "premium") as Obj;
    next.premium = { ...(p as LandingContent["premium"]), cards: arr(p.cards) as LandingContent["premium"]["cards"] };
    next.footer = formToObject(fd, "footer") as LandingContent["footer"];
  } else fail(BACK, "Bilinmeyen bölüm.");

  const parsed = landingSchema.safeParse(next);
  if (!parsed.success) {
    fail(back, describeIssue(parsed.error.issues[0] as unknown as Issue));
  }
  await db
    .insert(cmsDocuments)
    .values({ id: LANDING_ID, draft: parsed.data, updatedBy: admin.email })
    .onConflictDoUpdate({ target: cmsDocuments.id, set: { draft: parsed.data, updatedAt: new Date(), updatedBy: admin.email } });
  await audit(admin, "cms.save", section);
  revalidatePath(BACK);
  done(back, "Taslağa kaydedildi. Önizleyip yayınlayabilirsiniz.");
}

export async function publishLanding() {
  const admin = await requireAdmin("cms");
  const doc = await getLandingDoc();
  if (!doc) fail(BACK, "Taslak bulunamadı.");
  await db.update(cmsDocuments).set({ published: doc!.draft, publishedAt: new Date(), publishedBy: admin.email }).where(eq(cmsDocuments.id, LANDING_ID));
  await audit(admin, "cms.publish");
  revalidatePath("/");
  revalidatePath(BACK);
  done(BACK, "Site yayınlandı.");
}

export async function discardDraft() {
  const admin = await requireAdmin("cms");
  const doc = await getLandingDoc();
  if (!doc?.published) fail(BACK, "Yayında bir sürüm yok.");
  await db.update(cmsDocuments).set({ draft: doc!.published!, updatedAt: new Date(), updatedBy: admin.email }).where(eq(cmsDocuments.id, LANDING_ID));
  await audit(admin, "cms.save", "discard");
  revalidatePath(BACK);
  done(BACK, "Taslak, yayındaki içeriğe geri döndürüldü.");
}
