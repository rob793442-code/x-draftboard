// The X API monthly budget (admins). { monthly: 25 } sets it, { monthly: null } removes it.
import { NextResponse } from "next/server";
import { getBudget, monthSpend, setBudget } from "@/lib/spend";
import { bad, currentUser, forbidden, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const u = await currentUser();
  if (!u) return unauthorized();
  if (u.role !== "admin") return forbidden("Only admins can set the budget.");
  const { monthly } = (await req.json().catch(() => ({}))) as { monthly?: number | null };
  if (monthly !== null && monthly !== undefined && !(typeof monthly === "number" && monthly >= 0 && monthly < 100000)) return bad("Enter an amount in dollars, or leave it empty for no budget.");
  await setBudget(monthly ?? null);
  return NextResponse.json({ month: await monthSpend(), budget: await getBudget() });
}
