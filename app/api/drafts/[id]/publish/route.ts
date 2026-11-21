import { NextResponse } from "next/server";
import { markPosted, markScheduledInX, publishNow, schedule, setPostedLink, unmarkPosted, unschedule } from "@/lib/publish";
import { getBundle } from "@/lib/store";
import { bad, currentUser, forbidden, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";
// Post now runs in the request; a thread with videos can take a while for X to process.
export const maxDuration = 300;
type P = { params: Promise<{ id: string }> };

// Through X's API:
//   { when: "now" }               post it right away
//   { when: "<ISO time>" }        schedule it (or move the schedule)
// Posted by hand ("Post it yourself"):
//   { manual: "posted", link? }   someone posted it on X; link = the first post's URL (optional)
//   { manual: "scheduled", at }   someone scheduled it in X's composer for that time
//   { manual: "link", link }      add or fix the link of a post marked posted by hand
//   { manual: "undo" }            it wasn't posted after all
export async function POST(req: Request, { params }: P) {
  const u = await currentUser();
  if (!u) return unauthorized();
  if (!u.can_publish) return forbidden("Only admins can post and schedule.");
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { when?: string; manual?: string; link?: string; at?: string };
  try {
    if (body.manual === "posted") await markPosted(id, u, body.link);
    else if (body.manual === "scheduled") await markScheduledInX(id, u, new Date(body.at ?? ""));
    else if (body.manual === "link") await setPostedLink(id, u, body.link ?? "");
    else if (body.manual === "undo") await unmarkPosted(id, u);
    else if (body.when === "now") {
      const r = await publishNow(id, u);
      if (!r.ok) return NextResponse.json({ error: r.error, bundle: await getBundle(id) }, { status: 502 });
    } else await schedule(id, u, new Date(body.when ?? ""));
    return NextResponse.json(await getBundle(id));
  } catch (e) {
    return bad(e);
  }
}

// Take it off the schedule (the board's, or a "scheduled in X" note), or clear a failed attempt.
export async function DELETE(_: Request, { params }: P) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const { id } = await params;
  try {
    await unschedule(id, u);
    return NextResponse.json(await getBundle(id));
  } catch (e) {
    return bad(e);
  }
}
