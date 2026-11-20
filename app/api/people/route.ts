import { NextResponse } from "next/server";
import { taggablePeople } from "@/lib/people";
import { currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

// Teammates who can be @tagged in a comment (each tag is a Slack DM). Empty when Slack isn't set up.
export async function GET() {
  if (!(await currentUser())) return unauthorized();
  try {
    return NextResponse.json({ people: await taggablePeople() });
  } catch (e) {
    return NextResponse.json({ people: [], error: (e as Error).message });
  }
}
