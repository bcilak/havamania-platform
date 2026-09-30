import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { media } from "@/db/schema";
import { storage } from "@/lib/storage";

/** Medya kütüphanesi dosyaları herkese açıktır (site görselleri). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bulunamadı." }, { status: 404 });
  const [m] = await db.select().from(media).where(eq(media.id, id));
  const file = m ? await storage.get(m.storageKey) : null;
  if (!m || !file) return NextResponse.json({ error: "Bulunamadı." }, { status: 404 });
  return new Response(Buffer.from(file.data), {
    headers: {
      "content-type": m.mediaType,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
