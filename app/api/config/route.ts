// What the board needs to know about this deployment (no secrets): storage mode, which integrations are set up,
// and the scheduler's last run, for the Settings view.
import { NextResponse } from "next/server";
import { getState } from "@/lib/db";
import { getBudget, monthSpend } from "@/lib/spend";
import { ALLOWED_DOMAINS, APP_URL, EMAIL_ON, STORAGE, brand } from "@/lib/config";
import { slackIds } from "@/lib/people";
import { xConfigured } from "@/lib/x/account";
import { currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await currentUser();
  if (!u) return unauthorized();
  return NextResponse.json({
    app_url: APP_URL,
    storage: STORAGE,
    x_configured: xConfigured(),
    scheduler: { secret_set: !!process.env.CRON_SECRET, last_run: await getState<{ at: string }>("scheduler_last_run") },
    slack: { token_set: !!process.env.SLACK_BOT_TOKEN, people: slackIds().size, you: slackIds().has(u.email) },
    access: { domains: ALLOWED_DOMAINS, email_signin: EMAIL_ON },
    publishing: { method: brand.publishing.method, spend: { month: await monthSpend(), budget: await getBudget() } },
    dev_user: process.env.NODE_ENV !== "production" && !!process.env.DEV_USER,
  });
}
