import { NextResponse } from "next/server";
import { decideSuggestion } from "@/lib/store";
import { notifyDecided } from "@/lib/notify";
import { bad, currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const { action } = await req.json();
  if (!["accept", "reject", "withdraw"].includes(action)) return NextResponse.json({ error: "bad action" }, { status: 400 });
  try {
    const s = await decideSuggestion((await params).sid, u, action);
    if (s && action !== "withdraw") notifyDecided(u, s.draft_id, s, action === "accept");
    return NextResponse.json(s ?? { ok: true });
  } catch (e) {
    return bad(e);
  }
}
