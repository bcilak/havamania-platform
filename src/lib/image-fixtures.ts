import zlib from "node:zlib";
import sharp from "sharp";

/* Yalnızca testler ve smoke betiği kullanır: meta verili örnek görseller testte üretilir, repoya dosya eklenmez. */

export const EXIF_MARKER = "HM-EXIF-MARKER";

/** Konum, cihaz bilgisi ve EXIF yönü (varsayılan 6) taşıyan JPEG. */
export async function gpsJpeg(opts: { width?: number; height?: number; orientation?: number; marker?: string } = {}): Promise<Buffer> {
  const { width = 40, height = 20, orientation = 6, marker = EXIF_MARKER } = opts;
  return sharp({ create: { width, height, channels: 3, background: "#c00" } })
    .jpeg()
    .withMetadata({ orientation })
    .withExif({
      IFD0: { ImageDescription: marker, Make: "TestCam" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "39/1 55/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "32/1 51/1 0/1" },
    })
    .toBuffer();
}

/** Düz renkli PNG. */
export async function solidPng(width: number, height: number, background = "#08c"): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

/** Çok kareli GIF ya da WebP (kareler alt alta birleştirilir). */
export async function animated(format: "gif" | "webp", width = 8, height = 8): Promise<Buffer> {
  const frames = [await solidPng(width, height, "#f00"), await solidPng(width, height, "#00f")];
  const img = sharp(frames, { join: { animated: true } });
  return format === "gif" ? img.gif().toBuffer() : img.webp().toBuffer();
}

/** IHDR'den sonra `tEXt` parçası ekler (PNG metin meta verisi). */
export function pngWithText(png: Uint8Array, key: string, value: string): Buffer {
  return pngWithChunk(png, "tEXt", Buffer.from(`${key}\0${value}`, "latin1"));
}

/** IHDR'den sonra verilen türde ve gövdede (geçerli CRC'li) bir PNG parçası ekler. */
export function pngWithChunk(png: Uint8Array, type: string, body: Buffer): Buffer {
  const head = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head, body])));
  const chunk = Buffer.concat([len, head, body, crc]);
  const at = 8 + 25; // imza + IHDR (4 uzunluk + 4 ad + 13 veri + 4 CRC)
  return Buffer.concat([Buffer.from(png.subarray(0, at)), chunk, Buffer.from(png.subarray(at))]);
}
