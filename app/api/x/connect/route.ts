// Admins: start connecting the company X account. Sends them to X to approve the app; X sends them back to
// /api/x/callback. The PKCE verifier and state wait in a short-lived, encrypted, http-only cookie.
import { NextResponse } from "next/server";
import { seal } from "@/lib/crypto";
import { startConnect, xConfigured } from "@/lib/x/account";
import { APP_URL } from "@/lib/config";
import { currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await currentUser();
  if (!u) return NextResponse.redirect(`${APP_URL}/signin`);
  if (u.role !== "admin") return NextResponse.redirect(`${APP_URL}/?settings=1&x=admins-only`);
  if (!xConfigured()) return NextResponse.redirect(`${APP_URL}/?settings=1&x=not-configured`);
  const { url, state, verifier } = startConnect();
  const res = NextResponse.redirect(url);
  res.cookies.set("x_oauth", seal(JSON.stringify({ state, verifier, by: u.email })), {
    httpOnly: true,
    secure: APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/api/x",
    maxAge: 600,
  });
  return res;
}
