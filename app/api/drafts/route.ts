import { NextResponse, after } from "next/server";
import { createDraft, listDrafts } from "@/lib/store";
import { sql } from "@/lib/db";
import { runDue } from "@/lib/publish";
import { bad, currentUser, unauthorized } from "@/lib/user";
import { isBlankDraft } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const u = await currentUser();
  if (!u) return unauthorized();
  try {
    // While anyone has the board open, it posts due drafts within a minute or so, even between scheduler runs.
    const [due] = await sql`select 1 as due from drafts where publish_state = 'scheduled' and scheduled_at <= now() limit 1`;
    if (due) after(() => runDue().catch((e) => console.error("publish on board load:", (e as Error).message)));
    // A draft someone just started and hasn't written in yet only shows for them.
    return NextResponse.json((await listDrafts()).filter((d) => d.meta.created_by === u.email || !isBlankDraft(d)));
  } catch (e) {
    console.error("listing drafts:", e);
    return bad(e, 500);
  }
}

// "New draft": a blank draft in that folder, written by whoever is signed in. The editor takes it from there.
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { folder?: string; label?: string };
  try {
    return NextResponse.json(await createDraft(u, body), { status: 201 });
  } catch (e) {
    return bad(e);
  }
}
