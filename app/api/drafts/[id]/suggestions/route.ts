import { NextResponse } from "next/server";
import { addSuggestion } from "@/lib/store";
import { notifySuggestion } from "@/lib/notify";
import { bad, currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const { id } = await params;
  try {
    const s = await addSuggestion(id, u, await req.json());
    notifySuggestion(u, id, s);
    return NextResponse.json(s);
  } catch (e) {
    return bad(e);
  }
}
