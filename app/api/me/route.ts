import { NextResponse } from "next/server";
import { currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await currentUser();
  return u ? NextResponse.json(u) : unauthorized();
}
