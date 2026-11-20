import { NextResponse } from "next/server";
import { testSlack } from "@/lib/notify";
import { currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

// Sends the signed-in person one test DM, to check the Slack setup.
export async function POST() {
  const u = await currentUser();
  if (!u) return unauthorized();
  const r = await testSlack(u);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
