// The connected X account (no tokens): name, handle, avatar, check mark. Admins can refresh or disconnect it.
import { NextResponse } from "next/server";
import { disconnect, getAccount, refreshProfile, xConfigured } from "@/lib/x/account";
import { X_CALLBACK_URL } from "@/lib/config";
import { bad, currentUser, forbidden, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await currentUser())) return unauthorized();
  return NextResponse.json({ account: await getAccount(), configured: xConfigured(), callback_url: X_CALLBACK_URL });
}

// Re-read the profile from X (new avatar or name).
export async function POST() {
  const u = await currentUser();
  if (!u) return unauthorized();
  if (u.role !== "admin") return forbidden();
  try {
    return NextResponse.json({ account: await refreshProfile(), configured: xConfigured(), callback_url: X_CALLBACK_URL });
  } catch (e) {
    return bad(e, 502);
  }
}

export async function DELETE() {
  const u = await currentUser();
  if (!u) return unauthorized();
  if (u.role !== "admin") return forbidden();
  await disconnect();
  return NextResponse.json({ account: null, configured: xConfigured(), callback_url: X_CALLBACK_URL });
}
