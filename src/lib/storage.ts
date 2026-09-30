import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/*
 * Tek arayüz, iki sürücü. Dosyalar her zaman /api/files üzerinden sunulur
 * (admin oturumu ya da imzalı link), böylece depo hiçbir zaman herkese açık olmaz.
 */

type Stored = { data: Uint8Array; contentType: string };

interface Driver {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Stored | null>;
  remove(key: string): Promise<void>;
}

const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  ico: "image/x-icon",
};

export function extFor(mediaType: string, filename?: string): string {
  const fromName = filename?.split(".").pop()?.toLowerCase();
  if (fromName && EXT_TYPES[fromName]) return fromName;
  const hit = Object.entries(EXT_TYPES).find(([, t]) => t.split(";")[0] === mediaType);
  return hit?.[0] ?? "bin";
}

export function newStorageKey(folder: string, ext: string): string {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${folder}/${ym}/${crypto.randomUUID()}.${ext}`;
}

function localDriver(): Driver {
  const base = path.resolve(process.env.STORAGE_LOCAL_DIR || "./storage");
  const resolve = (key: string) => {
    const full = path.resolve(base, key);
    if (!full.startsWith(base + path.sep)) throw new Error("Geçersiz dosya yolu.");
    return full;
  };
  return {
    async put(key, data) {
      const full = resolve(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, data);
    },
    async get(key) {
      try {
        const data = await fs.readFile(resolve(key));
        const ext = key.split(".").pop()?.toLowerCase() ?? "";
        return { data: new Uint8Array(data), contentType: EXT_TYPES[ext] ?? "application/octet-stream" };
      } catch {
        return null;
      }
    },
    async remove(key) {
      await fs.rm(resolve(key), { force: true });
    },
  };
}

function s3Driver(): Driver {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("STORAGE_DRIVER=s3 için S3_BUCKET gerekli.");
  const client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    },
  });
  return {
    async put(key, data, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!res.Body) return null;
        return { data: await res.Body.transformToByteArray(), contentType: res.ContentType ?? "application/octet-stream" };
      } catch {
        return null;
      }
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

let driver: Driver | null = null;
function current(): Driver {
  driver ??= process.env.STORAGE_DRIVER === "s3" ? s3Driver() : localDriver();
  return driver;
}

export const storage = {
  put: (key: string, data: Uint8Array, contentType: string) => current().put(key, data, contentType),
  get: (key: string) => current().get(key),
  remove: (key: string) => current().remove(key),
  driverName: () => (process.env.STORAGE_DRIVER === "s3" ? "S3 uyumlu depo" : "Yerel disk"),
};
