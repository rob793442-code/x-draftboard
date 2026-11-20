import { NextResponse } from "next/server";
import { listVersions, restoreVersion } from "@/lib/store";
import { bad, currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: P) {
  if (!(await currentUser())) return unauthorized();
  return NextResponse.json(await listVersions((await params).id));
}

export async function POST(req: Request, { params }: P) {
  const u = await currentUser();
  if (!u) return unauthorized();
  const { version_id } = await req.json();
  try {
    return NextResponse.json(await restoreVersion((await params).id, Number(version_id), u));
  } catch (e) {
    return bad(e);
  }
}
