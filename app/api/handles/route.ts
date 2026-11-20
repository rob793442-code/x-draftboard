// @handle directory for the editor's mention menu and tag checks.
//   GET /api/handles?q=circ        -> { users: XUser[] }                                      directory matches, no X call
//   GET /api/handles?u=circle,wise -> { users: {handle: XUser}, missing: {handle: reason} }   looked up on X when not cached
import { NextResponse } from "next/server";
import { lookupDb, suggestDb } from "@/lib/handles-db";
import { currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await currentUser())) return unauthorized();
  const sp = new URL(req.url).searchParams;
  const u = sp.get("u");
  const limit = Math.min(Number(sp.get("limit")) || 6, 20);
  try {
    if (u !== null) return NextResponse.json(await lookupDb(u.split(",").slice(0, 100)));
    return NextResponse.json({ users: await suggestDb(sp.get("q") ?? "", limit) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
