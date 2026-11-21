// Admins: change someone's role, take their access away or give it back, or get a fresh invite link.
//   PATCH  { role: "admin" | "member" }  or  { blocked: true | false }
//   POST   resend the invite (and return its link)
import { NextResponse } from "next/server";
import { reinvite, setBlocked, setRole } from "@/lib/members";
import { bad, currentUser, forbidden, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ email: string }> };

export async function PATCH(req: Request, { params }: P) {
  const u = await currentUser();
  if (!u) return unauthorized();
  if (u.role !== "admin") return forbidden();
  const email = decodeURIComponent((await params).email);
  const body = (await req.json().catch(() => ({}))) as { role?: string; blocked?: boolean };
  try {
    if (body.role === "admin" || body.role === "member") await setRole(email, body.role, u.email);
    if (typeof body.blocked === "boolean") await setBlocked(email, body.blocked, u.email);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return bad(e);
  }
}

export async function POST(_: Request, { params }: P) {
  const u = await currentUser();
  if (!u) return unauthorized();
  if (u.role !== "admin") return forbidden();
  try {
    return NextResponse.json(await reinvite(u, decodeURIComponent((await params).email)));
  } catch (e) {
    return bad(e);
  }
}
