import { NextResponse } from "next/server";
import { moveDraft } from "@/lib/store";
import { bad, currentUser, forbidden, unauthorized } from "@/lib/user";
import { FOLDERS } from "@/lib/types";

export const dynamic = "force-dynamic";

// Admins, drag and drop: put the draft in `folder` at its place in `ids` (that folder's drafts, top to bottom).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return unauthorized();
  if (u.role !== "admin") return forbidden("Only an admin can rearrange drafts.");
  const body = (await req.json().catch(() => ({}))) as { folder?: string; ids?: unknown };
  if (!FOLDERS.some((f) => f.key === body.folder)) return NextResponse.json({ error: `unknown folder: ${body.folder}` }, { status: 400 });
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  try {
    return NextResponse.json(await moveDraft((await params).id, body.folder!, ids, u));
  } catch (e) {
    return bad(e);
  }
}
