// Where uploaded images and videos live. Server-only.
//   Vercel Blob (BLOB_READ_WRITE_TOKEN set): the browser uploads straight to Blob (app/api/upload), files are public URLs.
//   Local (development without a Blob token): files go to .data/uploads and are served by /api/media/...
// The publisher reads media back through openMedia() in chunks, so big videos never sit in memory whole.
import fs from "node:fs";
import path from "node:path";
import { del } from "@vercel/blob";
import { STORAGE } from "./config";
import type { Media } from "./types";

export const LOCAL_DIR = path.resolve(process.env.LOCAL_UPLOADS_DIR ?? ".data/uploads");
const LOCAL_PREFIX = "/api/media/";

export const localUrl = (rel: string) => `${LOCAL_PREFIX}${rel.split("/").map(encodeURIComponent).join("/")}`;

/** The file on disk behind a local media path, or null if the path tries to leave the uploads folder. */
export function localFile(rel: string): string | null {
  const p = path.resolve(LOCAL_DIR, rel);
  return p.startsWith(LOCAL_DIR + path.sep) ? p : null;
}

export async function saveLocal(rel: string, data: Buffer) {
  const p = localFile(rel);
  if (!p) throw new Error("bad upload path");
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, data);
}

export async function deleteFiles(urls: string[]) {
  const blob = urls.filter((u) => /^https:\/\//.test(u));
  const local = urls.filter((u) => u.startsWith(LOCAL_PREFIX));
  if (blob.length && STORAGE === "blob") await del(blob);
  for (const u of local) {
    const p = localFile(decodeURIComponent(u.slice(LOCAL_PREFIX.length)));
    if (p) await fs.promises.rm(p, { force: true });
  }
}

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime" };
export const contentTypeOf = (name: string) => TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";

export type MediaFile = { size: number; contentType: string; read(start: number, end: number): Promise<Buffer> };

/** Opens an uploaded file for reading in ranges (end exclusive). */
export async function openMedia(m: Media): Promise<MediaFile> {
  const url = m.url ?? localUrl(m.path);
  if (url.startsWith(LOCAL_PREFIX)) {
    const p = localFile(decodeURIComponent(url.slice(LOCAL_PREFIX.length)));
    if (!p) throw new Error(`bad media path: ${m.path}`);
    const { size } = await fs.promises.stat(p);
    return {
      size,
      contentType: contentTypeOf(p),
      read: async (start, end) => {
        const fh = await fs.promises.open(p, "r");
        try {
          const buf = Buffer.alloc(end - start);
          await fh.read(buf, 0, end - start, start);
          return buf;
        } finally {
          await fh.close();
        }
      },
    };
  }
  const head = await fetch(url, { method: "HEAD", cache: "no-store" });
  if (!head.ok) throw new Error(`Couldn't read ${m.path} (${head.status})`);
  const size = Number(head.headers.get("content-length"));
  const contentType = head.headers.get("content-type") ?? contentTypeOf(m.path);
  if (!size) throw new Error(`Couldn't tell the size of ${m.path}`);
  return {
    size,
    contentType,
    read: async (start, end) => {
      const r = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` }, cache: "no-store" });
      if (!r.ok) throw new Error(`Couldn't read ${m.path} (${r.status})`);
      const buf = Buffer.from(await r.arrayBuffer());
      // A server that ignores Range sends the whole file: take the slice we asked for.
      return r.status === 206 ? buf : buf.subarray(start, end);
    },
  };
}
