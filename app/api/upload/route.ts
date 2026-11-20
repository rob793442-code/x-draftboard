// Media for a post.
//   Vercel Blob: the browser uploads straight to Blob (a function can't take a big video) and this route only hands a
//   signed-in person a short-lived token for a path under uploads/.
//   Local development (no Blob token): the file comes in a form and is saved to .data/uploads.
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { STORAGE } from "@/lib/config";
import { localUrl, saveLocal } from "@/lib/storage";
import { bad, currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

const TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/quicktime"];

export async function POST(req: Request) {
  if (!(await currentUser())) return unauthorized();
  if (STORAGE === "local") {
    const form = await req.formData();
    const file = form.get("file");
    const rel = String(form.get("path") ?? "");
    if (!(file instanceof File)) return bad("file required");
    if (!TYPES.includes(file.type)) return bad(`unsupported type ${file.type}`);
    if (!rel.startsWith("uploads/") || rel.includes("..")) return bad("bad upload path");
    const name = rel.replace(/(\.[^./]+)?$/, (ext) => `-${Date.now().toString(36)}${ext}`);
    await saveLocal(name, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ url: localUrl(name), pathname: name });
  }
  try {
    const body = (await req.json()) as HandleUploadBody;
    const res = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("uploads/") || pathname.includes("..")) throw new Error("bad upload path");
        // X takes images up to 5 MB, GIFs up to 15 MB and videos up to 8 GB (Premium 16 GB); 1 GB is plenty here.
        return { allowedContentTypes: TYPES, maximumSizeInBytes: 1024 * 1024 * 1024, addRandomSuffix: true };
      },
    });
    return NextResponse.json(res);
  } catch (e) {
    return bad(e);
  }
}
