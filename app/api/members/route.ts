// Admins: who has access (Settings → People), and inviting someone new.
import { NextResponse } from "next/server";
import { invite, listMembers } from "@/lib/members";
import { bad, currentUser, forbidden, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await currentUser();
  if (!u) return unauthorized();
  if (u.role !== "admin") return forbidden();
  return NextResponse.json({ members: await listMembers() });
}

// { email, role?: "member" | "admin", note? } → { email, invite_url, emailed, already_in, external }
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u) return unauthorized();
  if (u.role !== "admin") return forbidden("Only admins can invite people.");
  try {
    return NextResponse.json(await invite(u, await req.json()));
  } catch (e) {
    return bad(e);
  }
}
