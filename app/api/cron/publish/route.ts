// The scheduler: posts every draft whose time has come. Called by Vercel Schedules (vercel.json), or any other
// pinger (GitHub Actions, cron-job.org) with "Authorization: Bearer <CRON_SECRET>". See docs/scheduling.md.
import { NextResponse } from "next/server";
import { setState } from "@/lib/db";
import { runDue } from "@/lib/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function tick(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = await runDue();
  await setState("scheduler_last_run", { at: new Date().toISOString(), posted: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
  return NextResponse.json({ ok: true, results });
}

export const GET = tick;
export const POST = tick;
