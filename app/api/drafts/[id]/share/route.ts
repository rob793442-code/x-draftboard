import { NextResponse } from "next/server";
import { ensureShareUrl } from "@/lib/store";
import { bad, currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

// The draft's share link (made on first use): paste it in Slack and it unfurls with the copy and image.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return unauthorized();
  try {
    const url = await ensureShareUrl((await params).id);
    return url ? NextResponse.json({ url }) : NextResponse.json({ error: "Draft not found." }, { status: 404 });
  } catch (e) {
    return bad(e);
  }
}
