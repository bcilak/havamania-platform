"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/db";
import { cmsDocuments, kbSources, type ChatMode } from "@/db/schema";
import { processSource } from "@/lib/ai/ingest";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { getMainBot } from "@/lib/bot";
import { MODES } from "@/lib/bot-config";
import { landingToText } from "@/lib/cms/flatten";
import { defaultLandingContent } from "@/lib/cms/schema";
import { done, fail, str } from "@/lib/form";
import { extFor, newStorageKey, storage } from "@/lib/storage";

const BACK = "/admin/egitim/bilgi-tabani";
const FILE_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

function modeOf(fd: FormData): ChatMode | "all" {
  const m = str(fd, "mode");
  return MODES.includes(m as ChatMode) ? (m as ChatMode) : "all";
}

export async function uploadSource(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) fail(BACK, "Bir dosya seçin.");
  const f = file as File;
  const type = f.type || (f.name.endsWith(".md") ? "text/markdown" : f.name.endsWith(".txt") ? "text/plain" : "");
  if (!FILE_TYPES.includes(type)) fail(BACK, "Desteklenen türler: PDF, DOCX, TXT, MD.");
  if (f.size > 20 * 1024 * 1024) fail(BACK, "Dosya en fazla 20 MB olabilir.");
  const key = newStorageKey("kb", extFor(type, f.name));
  await storage.put(key, new Uint8Array(await f.arrayBuffer()), type);
  const [src] = await db
    .insert(kbSources)
    .values({
      botId: bot.id,
      type: "file",
      mode: modeOf(fd),
      title: str(fd, "title", 200) || f.name,
      storageKey: key,
      mediaType: type,
      createdBy: admin.email,
    })
    .returning();
  after(() => processSource(src.id));
  await audit(admin, "kb.create", src.id, { type: "file", title: src.title });
  revalidatePath(BACK);
  done(BACK, `"${src.title}" yüklendi, işleniyor.`);
}

export async function addUrl(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const raw = str(fd, "url", 1000);
  let url: URL;
  try {
    url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    fail(BACK, "Geçerli bir web adresi girin (https://…).");
  }
  const [src] = await db
    .insert(kbSources)
    .values({ botId: bot.id, type: "url", mode: modeOf(fd), title: url!.toString(), url: url!.toString(), createdBy: admin.email })
    .returning();
  after(() => processSource(src.id));
  await audit(admin, "kb.create", src.id, { type: "url", url: src.url });
  revalidatePath(BACK);
  done(BACK, "Sayfa eklendi, içeriği alınıyor.");
}

export async function addQa(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const question = str(fd, "question", 1000);
  const answer = str(fd, "answer", 6000);
  if (!question || !answer) fail(BACK + "#sss", "Soru ve cevap boş olamaz.");
  const [src] = await db
    .insert(kbSources)
    .values({ botId: bot.id, type: "qa", mode: modeOf(fd), title: question.slice(0, 160), question, answer, priority: 5, createdBy: admin.email })
    .returning();
  after(() => processSource(src.id));
  await audit(admin, "kb.create", src.id, { type: "qa", question });
  revalidatePath(BACK);
  done(BACK, "Soru-cevap eklendi.");
}

export async function importCms() {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const [doc] = await db.select().from(cmsDocuments).where(eq(cmsDocuments.id, "landing"));
  const text = landingToText(doc?.published ?? doc?.draft ?? defaultLandingContent());
  const [existing] = await db.select().from(kbSources).where(and(eq(kbSources.botId, bot.id), eq(kbSources.type, "cms")));
  let id: string;
  if (existing) {
    await db.update(kbSources).set({ answer: text, updatedAt: new Date() }).where(eq(kbSources.id, existing.id));
    id = existing.id;
  } else {
    const [src] = await db
      .insert(kbSources)
      .values({ botId: bot.id, type: "cms", mode: "all", title: "Havamania web sitesi içeriği", answer: text, createdBy: admin.email })
      .returning();
    id = src.id;
  }
  after(() => processSource(id));
  await audit(admin, "kb.create", id, { type: "cms" });
  revalidatePath(BACK);
  done(BACK, "Site içeriği bilgi tabanına aktarıldı.");
}

export async function reprocess(fd: FormData) {
  await requireAdmin("training");
  const id = str(fd, "id");
  await db.update(kbSources).set({ status: "pending" }).where(eq(kbSources.id, id));
  after(() => processSource(id));
  revalidatePath(BACK);
  done(BACK, "Yeniden işleniyor.");
}

export async function deleteSource(fd: FormData) {
  const admin = await requireAdmin("training");
  const id = str(fd, "id");
  const [src] = await db.select().from(kbSources).where(eq(kbSources.id, id));
  if (!src) fail(BACK, "Kaynak bulunamadı.");
  if (src!.storageKey) await storage.remove(src!.storageKey).catch(() => {});
  await db.delete(kbSources).where(eq(kbSources.id, id));
  await audit(admin, "kb.delete", id, { title: src!.title });
  revalidatePath(BACK);
  done(BACK, `"${src!.title}" silindi. Yayındaki sürüm, yeniden yayınlayana kadar bu kaynağı kullanmaz.`);
}
