import { NextResponse } from "next/server";
import { publishNow, schedule, unschedule } from "@/lib/publish";
import { getBundle } from "@/lib/store";
import { bad, currentUser, forbidden, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";
// Post now runs in the request; a thread with videos can take a while for X to process.
export const maxDuration = 300;
type P = { params: Promise<{ id: string }> };

// { when: "now" } posts it right away; { when: "<ISO time>" } schedules it (or moves the schedule).
export async function POST(req: Request, { params }: P) {
  const u = await currentUser();
  if (!u) return unauthorized();
  if (!u.can_publish) return forbidden("Only admins can post and schedule.");
  const { id } = await params;
  const { when } = (await req.json().catch(() => ({}))) as { when?: string };
  try {
    if (when === "now") {
      const r = await publishNow(id, u);
      if (!r.ok) return NextResponse.json({ error: r.error, bundle: await getBundle(id) }, { status: 502 });
    } else await schedule(id, u, new Date(when ?? ""));
    return NextResponse.json(await getBundle(id));
  } catch (e) {
    return bad(e);
  }
}

// Take it off the schedule (or clear a failed attempt).
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
