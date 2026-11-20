import { NextResponse } from "next/server";
import { deleteDraft, discardBlank, editDraft, getBundle } from "@/lib/store";
import { bad, currentUser, forbidden, unauthorized } from "@/lib/user";
import type { Draft } from "@/lib/types";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: P) {
  if (!(await currentUser())) return unauthorized();
  const b = await getBundle((await params).id);
  return b ? NextResponse.json(b) : NextResponse.json({ error: "not found" }, { status: 404 });
}

// A direct edit: the draft's writer or an admin. Everyone else suggests edits instead. ?autosave=1 (the editor
// saving as you type) keeps one history version per 5 minutes of writing.
export async function PATCH(req: Request, { params }: P) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const body = (await req.json()) as Partial<Draft>;
  const autosave = new URL(req.url).searchParams.get("autosave") === "1";
  try {
    return NextResponse.json(await editDraft((await params).id, u, body, { autosave }));
  } catch (e) {
    const msg = (e as Error).message;
    return msg.startsWith("Only") ? forbidden(msg) : bad(e);
  }
}

// Admins: delete the draft for good. With ?blank=1: the editor throwing away an empty draft its writer left.
export async function DELETE(req: Request, { params }: P) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const { id } = await params;
  try {
    if (new URL(req.url).searchParams.get("blank") === "1") return NextResponse.json(await discardBlank(id, u));
    if (u.role !== "admin") return forbidden("Only an admin can delete a draft.");
    return NextResponse.json(await deleteDraft(id, u));
  } catch (e) {
    return bad(e, 409);
  }
}
