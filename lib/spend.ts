// A running log of what the board spends on X's API (estimated from lib/x/pricing.ts), and an optional monthly budget
// an admin sets in Settings. Once a post would go over the budget, the board stops posting through the API (people
// can still post it themselves). Server-only. The real meter is X's Developer Console; set a spending limit there too.
import { getState, setState, sql } from "./db";

export async function recordSpend(kind: string, cost: number, draftId?: string | null) {
  if (cost > 0) await sql`insert into api_spend (kind, cost, draft_id) values (${kind}, ${cost}, ${draftId ?? null})`.catch(() => {});
}

/** Spent so far this calendar month (UTC). */
export async function monthSpend(): Promise<number> {
  const [r] = await sql`select coalesce(sum(cost), 0)::float8 as total from api_spend where at >= date_trunc('month', now())`;
  return Number(r?.total ?? 0);
}

export async function getBudget(): Promise<number | null> {
  const b = await getState<{ monthly: number | null }>("x_budget");
  return typeof b?.monthly === "number" && b.monthly > 0 ? b.monthly : null;
}

export async function setBudget(monthly: number | null) {
  await setState("x_budget", { monthly: monthly && monthly > 0 ? Math.round(monthly * 100) / 100 : null });
}

/** Why spending `extra` now would break the budget, or null if it's fine. */
export async function overBudget(extra: number): Promise<string | null> {
  const budget = await getBudget();
  if (budget === null) return null;
  const spent = await monthSpend();
  if (spent + extra <= budget + 1e-9) return null;
  return `That would go over this month's X API budget ($${spent.toFixed(2)} of $${budget.toFixed(2)} spent). Post it yourself instead, or an admin can raise the budget in Settings.`;
}
