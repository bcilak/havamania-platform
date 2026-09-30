import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifyAdminSession, verifyFileSignature } from "@/lib/session";
import { storage } from "@/lib/storage";

/** Depodaki dosyalar: admin oturumu ya da süreli imzalı bağlantı gerekir. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");
  const signed = verifyFileSignature(key, request.nextUrl.searchParams.get("exp"), request.nextUrl.searchParams.get("sig"));
  const admin = signed ? null : await verifyAdminSession(request.cookies.get(ADMIN_COOKIE)?.value);
  if (!signed && !admin) return NextResponse.json({ error: "Yetkisiz." }, { status: 403 });
  if (key.startsWith("kb/") && !admin) return NextResponse.json({ error: "Yetkisiz." }, { status: 403 });

  const file = await storage.get(key);
  if (!file) return NextResponse.json({ error: "Dosya bulunamadı." }, { status: 404 });
  return new Response(Buffer.from(file.data), {
    headers: {
      "content-type": file.contentType,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      // Kullanıcının yüklediği bir SVG bile olsa betik çalıştıramasın.
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
