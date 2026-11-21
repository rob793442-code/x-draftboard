// Local development only: serves uploads saved to .data/uploads when there's no Vercel Blob token.
import fs from "node:fs";
import { contentTypeOf, localFile } from "@/lib/storage";
import { STORAGE } from "@/lib/config";
import { currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (STORAGE !== "local") return new Response("not found", { status: 404 });
  if (!(await currentUser())) return new Response("sign in first", { status: 401 });
  const p = localFile((await params).path.map(decodeURIComponent).join("/"));
  if (!p || !fs.existsSync(p)) return new Response("not found", { status: 404 });
  const size = fs.statSync(p).size;
  const type = contentTypeOf(p);
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    const body = fs.createReadStream(p, { start, end }) as unknown as ReadableStream;
    return new Response(body, { status: 206, headers: { "content-type": type, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes" } });
  }
  // ?download=1 (Post it yourself → Download): save it instead of showing it, like Vercel Blob's download URLs
  const download: Record<string, string> = new URL(req.url).searchParams.get("download") === "1" ? { "content-disposition": `attachment; filename="${p.split("/").pop()}"` } : {};
  return new Response(fs.createReadStream(p) as unknown as ReadableStream, { headers: { "content-type": type, "content-length": String(size), "accept-ranges": "bytes", ...download } });
}
