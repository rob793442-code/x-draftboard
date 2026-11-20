// Who is making this request, and what they may do.
import { NextResponse } from "next/server";
import { auth } from "./auth";
import { ADMIN_EMAILS, brand, isAllowedEmail } from "./config";
import type { Me } from "./types";

const firstName = (name: string | null | undefined, email: string) => name?.split(/\s+/)[0] || email.split("@")[0].replace(/^./, (c) => c.toUpperCase());

function me(email: string, name?: string | null): Me {
  const role = ADMIN_EMAILS.includes(email) ? "admin" : "member";
  return { name: firstName(name, email), email, role, can_publish: role === "admin" || brand.publishing.whoCanPublish === "everyone" };
}

export async function currentUser(): Promise<Me | null> {
  // Local development only (ignored in production builds): act as this person without Google sign-in.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_USER) return me(process.env.DEV_USER.trim().toLowerCase());
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email || !isAllowedEmail(email)) return null;
  return me(email, session?.user?.name);
}

export const unauthorized = () => NextResponse.json({ error: "Sign in first." }, { status: 401 });
export const forbidden = (why = "Only an admin can do that.") => NextResponse.json({ error: why }, { status: 403 });
export const bad = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
