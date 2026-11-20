import { NextResponse } from "next/server";
import { addVerdict } from "@/lib/store";
import { notifyVerdict } from "@/lib/notify";
import { bad, currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const { id } = await params;
  const { verdict, reason } = await req.json();
  if (!["approve", "needs_work", "kill"].includes(verdict)) return NextResponse.json({ error: "bad verdict" }, { status: 400 });
  try {
    const v = await addVerdict(id, u, verdict, reason);
    notifyVerdict(u, id, verdict, v.reason);
    return NextResponse.json(v);
  } catch (e) {
    return bad(e);
  }
}
