import { NextResponse } from "next/server";
import { addComment } from "@/lib/store";
import { notifyComment } from "@/lib/notify";
import { bad, currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const { id } = await params;
  try {
    const c = await addComment(id, u, await req.json());
    notifyComment(u, id, c.id);
    return NextResponse.json(c);
  } catch (e) {
    return bad(e);
  }
}
