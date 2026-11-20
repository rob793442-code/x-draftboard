import { NextResponse } from "next/server";
import { notifyNewDraft } from "@/lib/notify";
import { currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

// The editor calls this when a writer steps away from their draft (another draft, the Review tab, closing the page).
// The first time it has words in it, admins get one Slack DM about it. Safe to call any number of times.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return unauthorized();
  notifyNewDraft(u, (await params).id);
  return NextResponse.json({ ok: true }, { status: 202 });
}
