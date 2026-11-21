// Who is making this request, and what they may do. Checked on every request, so removing someone in Settings → People
// locks them out right away.
import { NextResponse } from "next/server";
import { auth } from "./auth";
import { brand } from "./config";
import { accessFor, recordSeen } from "./members";
import type { Me } from "./types";

const firstName = (name: string | null | undefined, email: string) => name?.split(/\s+/)[0] || email.split("@")[0].replace(/^./, (c) => c.toUpperCase());

async function me(email: string, name?: string | null): Promise<Me | null> {
  const a = await accessFor(email);
  if (!a) return null;
  // keeps "last seen" in the People list roughly current without a write on every request
  if (!a.last_seen || Date.now() - Date.parse(a.last_seen) > 3600_000) recordSeen(email, name).catch(() => {});
  return { name: firstName(name, email), email, role: a.role, external: a.external, can_publish: a.role === "admin" || brand.publishing.whoCanPublish === "everyone" };
}

export async function currentUser(): Promise<Me | null> {
  // Local development only (ignored in production builds): act as this person without signing in.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_USER) return me(process.env.DEV_USER.trim().toLowerCase());
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  return email ? me(email, session?.user?.name) : null;
}

export const unauthorized = () => NextResponse.json({ error: "Sign in first." }, { status: 401 });
export const forbidden = (why = "Only an admin can do that.") => NextResponse.json({ error: why }, { status: 403 });
export const bad = (e: unknown, status = 400) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
