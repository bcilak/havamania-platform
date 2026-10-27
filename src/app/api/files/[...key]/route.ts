import { NextResponse, type NextRequest } from "next/server";
import { cleanForServing } from "@/lib/image-sanitize";
import { IMAGE_RETRY_AFTER, runImageWork } from "@/lib/image-limiter";
import { LimiterBusyError } from "@/lib/limiter";
import { allow, clientIp, LIMITS, tooMany } from "@/lib/rate-limit";
import { can } from "@/lib/roles";
import { ADMIN_COOKIE, verifyAdminSession, verifyFileSignature } from "@/lib/session";
import { canonicalKey, storage } from "@/lib/storage";

const notFound = () => NextResponse.json({ error: "Dosya bulunamadı." }, { status: 404 });

/** Anahtarı tek seferde çözer ve kanonikliğini doğrular; geçersizse null. Sonraki tüm kontroller bu anahtarla yapılır. */
function keyFromParts(parts: string[]): string | null {
  try {
    const decoded = parts.map(decodeURIComponent);
    // `photos%2Fx.jpg` gibi kodlanmış eğik çizgi tek parçada gelir; anahtar yalnızca gerçek yol parçalarından oluşur.
    if (decoded.some((p) => p.includes("/"))) return null;
    return canonicalKey(decoded.join("/"));
  } catch {
    return null; // bozuk %-kodlaması
  }
}

/** Depodaki dosyalar: admin oturumu ya da süreli imzalı bağlantı gerekir. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  // `.%2Fphotos%2F..`, `kb%2F..%2Fphotos%2F..` gibi kanonik olmayan anahtarlar izin ve temizlik denetimini atlatamasın.
  const key = keyFromParts(parts);
  if (!key) return notFound();
  // Önek denetimleri büyük/küçük harf duyarsız dosya sistemlerinde (Windows, macOS) `Photos/` ile atlatılamasın.
  const lower = key.toLowerCase();
  const isPhoto = lower.startsWith("photos/");
  const isKb = lower.startsWith("kb/");

  const signed = verifyFileSignature(key, request.nextUrl.searchParams.get("exp"), request.nextUrl.searchParams.get("sig"));
  const admin = signed ? null : await verifyAdminSession(request.cookies.get(ADMIN_COOKIE)?.value);
  if (!signed && !admin) return NextResponse.json({ error: "Yetkisiz." }, { status: 403 });
  if (isKb && !admin) return NextResponse.json({ error: "Yetkisiz." }, { status: 403 });
  // Kullanıcı fotoğrafları yalnızca "photos" iznine sahip rollere açık (imzalı bağlantı sahibi etkilenmez).
  if (isPhoto && admin && !can(admin.role, "photos")) return NextResponse.json({ error: "Yetkisiz." }, { status: 403 });
  // Oturumsuz (imzalı) istekler IP ve anahtar başına hız sınırına tabidir.
  if (signed && (!allow(`file-ip:${clientIp(request)}`, LIMITS.fileSignedPerMinPerIp) || !allow(`file-key:${key}`, LIMITS.fileSignedPerMinPerKey))) return tooMany();

  // Kullanıcı fotoğrafları (photos/, demo hariç) uzantıya ve depodaki türe güvenilmeden içerikten koklanır: eski anahtarlar
  // .bin/.pdf/.txt/.svg uzantısıyla saklanmış gerçek JPEG olabilir. Meta veri taşıyorsa bellekte temizlenip sunulur;
  // tanınmayan, temizlenemeyen biçim ve HEIC sunulmaz. Content-Type çıktının biçiminden gelir.
  let data: Uint8Array;
  let contentType: string;
  if (isPhoto && !lower.startsWith("photos/demo/")) {
    try {
      // Dosya belleğe yalnızca görsel işleme yuvası alındıktan sonra okunur: kuyrukta bekleyen istek bellek tutmaz.
      const result = await runImageWork(async () => {
        const file = await storage.get(key);
        if (!file) return null;
        const clean = await cleanForServing(file.data);
        return { data: clean.data, contentType: clean.mediaType };
      });
      if (!result) return notFound();
      ({ data, contentType } = result);
    } catch (err) {
      if (err instanceof LimiterBusyError) {
        return NextResponse.json({ error: "Sunucu meşgul. Birkaç saniye sonra tekrar deneyin." }, { status: 503, headers: { "retry-after": IMAGE_RETRY_AFTER } });
      }
      return NextResponse.json({ error: "Dosya güvenli biçimde sunulamıyor." }, { status: 415 });
    }
  } else {
    const file = await storage.get(key);
    if (!file) return notFound();
    ({ data, contentType } = file);
  }
  return new Response(Buffer.from(data), {
    headers: {
      "content-type": contentType,
      // private: yetkili ya da imzalı istek yanıtı paylaşımlı önbelleğe girmez (temizlenmiş fotoğraf dahil).
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      // Kullanıcının yüklediği bir SVG bile olsa betik çalıştıramasın.
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
