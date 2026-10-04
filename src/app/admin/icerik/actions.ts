"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { cmsDocuments } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { getLanding, getLandingDoc, LANDING_ID } from "@/lib/cms/store";
import { landingSchema, type LandingContent, type SceneKey } from "@/lib/cms/schema";
import { done, fail, formToObject, str } from "@/lib/form";

const BACK = "/admin/icerik";

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []).filter(Boolean) as Obj[];

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

/* Doğrulama hatasındaki alan yolunu editörün gördüğü adlarla yazmak için. */
const LABELS: Record<string, string> = {
  scenes: "",
  core: "Panel sahnesi",
  agro: "Agro sahnesi",
  fly: "Fly sahnesi",
  seo: "Arama motorları",
  hero: "Hero",
  nav: "Menü",
  phase2: "Modlar bölümü",
  assistant: "Asistan bölümü",
  premium: "Premium",
  footer: "Alt bilgi",
  captions: "Başlıklar",
  chips: "Çipler",
  screen1: "1. ekran",
  screen2: "2. ekran",
  screen3: "3. ekran",
  slots: "hücreler",
  cards: "kartlar",
  bubbles: "mesajlar",
  eyebrow: "üst etiket",
  title: "başlık",
  sub: "alt metin",
  subtitle: "alt metin",
  text: "metin",
  icon: "ikon",
  label: "etiket",
  value: "değer",
  unit: "birim",
  header: "üst satır",
  location: "konum satırı",
  temp: "büyük değer",
  condition: "durum",
  note: "not",
  ringValue: "halka değeri",
  ringLabel: "halka etiketi",
  description: "açıklama",
  ctaLabel: "buton",
};

function describeIssue(issue: { code: string; message: string; path: PropertyKey[]; maximum?: unknown; minimum?: unknown }): string {
  const where = issue.path
    .map((p) => (typeof p === "number" ? `${p + 1}.` : (LABELS[String(p)] ?? String(p))))
    .filter(Boolean)
    .join(" › ");
  const what =
    issue.code === "too_big"
      ? `en fazla ${String(issue.maximum)} karakter olabilir`
      : issue.code === "too_small"
        ? Number(issue.minimum) > 1
          ? `en az ${String(issue.minimum)} tane olmalı`
          : "boş bırakılamaz"
        : "geçersiz";
  return `${where}: ${what}`;
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
  } else if (section === "core" || section === "agro" || section === "fly") {
    next.scenes[section] = sceneFrom(fd);
  } else if (section === "bolumler") {
    next.phase2 = formToObject(fd, "phase2") as LandingContent["phase2"];
    next.assistant = formToObject(fd, "assistant") as LandingContent["assistant"];
  } else if (section === "premium") {
    const p = formToObject(fd, "premium") as Obj;
    next.premium = { ...(p as LandingContent["premium"]), cards: arr(p.cards) as LandingContent["premium"]["cards"] };
    next.footer = formToObject(fd, "footer") as LandingContent["footer"];
  } else fail(BACK, "Bilinmeyen bölüm.");

  const parsed = landingSchema.safeParse(next);
  if (!parsed.success) {
    fail(back, describeIssue(parsed.error.issues[0] as Parameters<typeof describeIssue>[0]));
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
