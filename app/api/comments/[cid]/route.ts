import { NextResponse } from "next/server";
import { deleteComment, setResolved } from "@/lib/store";
import { notifyResolved } from "@/lib/notify";
import { currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ cid: string }> };

export async function PATCH(req: Request, { params }: P) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const { resolved } = await req.json();
  const c = await setResolved((await params).cid, u, !!resolved);
  if (c && resolved) notifyResolved(u, c.draft_id, c.parent_id ?? c.id);
  return c ? NextResponse.json(c) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(_: Request, { params }: P) {
  const u = await currentUser();
  if (!u) return unauthorized();
  await deleteComment((await params).cid, u);
  return NextResponse.json({ ok: true });
}
