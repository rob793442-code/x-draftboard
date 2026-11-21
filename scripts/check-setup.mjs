#!/usr/bin/env node
// What's set up and what's missing. Reads .env.local (if any) plus the real environment, and brand.config.ts.
// Prints names only, never values.
import fs from "node:fs";

const env = { ...process.env };
for (const f of [".env", ".env.local"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[2] && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const has = (k) => !!(env[k] && env[k].trim());
const brand = fs.readFileSync("brand.config.ts", "utf8");

const checks = [
  ["Branding", [
    [!/name: "Draftboard"/.test(brand), 'brand.config.ts has your board name (still "Draftboard")'],
    [!/handle: "yourcompany"/.test(brand), "brand.config.ts has your X handle"],
    [!/logo: "\/logo\.svg"/.test(brand) || !fs.readFileSync("public/logo.svg", "utf8").includes("#1D9BF0"), "your logo is in public/ (still the placeholder)"],
  ]],
  ["Sign-in", [
    [has("ALLOWED_EMAIL_DOMAINS"), "ALLOWED_EMAIL_DOMAINS (your company domain; guests are invited in Settings → People)"],
    [has("ADMIN_EMAILS"), "ADMIN_EMAILS"],
    [has("AUTH_SECRET"), "AUTH_SECRET"],
    [has("AUTH_GOOGLE_ID") && has("AUTH_GOOGLE_SECRET"), "AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET (docs/google-oauth.md)", "local dev can use DEV_USER instead"],
  ]],
  ["Storage", [
    [has("DATABASE_URL"), "DATABASE_URL (Postgres)", "local dev uses the built-in database"],
    [has("BLOB_READ_WRITE_TOKEN"), "BLOB_READ_WRITE_TOKEN (Vercel Blob)", "local dev saves uploads to .data/uploads"],
  ]],
  ...(/method: "manual"/.test(brand)
    ? [["X", [[true, 'posting by hand (publishing.method is "manual"): no X app or scheduler needed']]]]
    : [
        ["X API (posting and scheduling by the board)", [[has("X_CLIENT_ID") && has("X_CLIENT_SECRET"), "X_CLIENT_ID / X_CLIENT_SECRET (docs/x-api.md); then connect the account in Settings", "without it, posts go out by hand"]]],
        ["Scheduler", [[has("CRON_SECRET"), "CRON_SECRET (docs/scheduling.md)", "only for posts the board schedules"]]],
      ]),
  ["Email sign-in links for guests (optional)", [[has("AUTH_RESEND_KEY") && has("EMAIL_FROM"), "AUTH_RESEND_KEY / EMAIL_FROM (docs/people.md)", "optional; guests can use Google"]]],
  ["Slack (optional)", [[has("SLACK_BOT_TOKEN") && has("SLACK_USERS"), "SLACK_BOT_TOKEN / SLACK_USERS (docs/slack.md)", "optional"]]],
];

console.log(`Checking ${fs.existsSync(".env.local") ? ".env.local + environment" : "environment (no .env.local)"}. Production values live in your host (e.g. Vercel); this only sees local ones.\n`);
for (const [group, items] of checks) {
  console.log(group);
  for (const [ok, what, note] of items) console.log(`  ${ok ? "✓" : note ? "·" : "✗"} ${what}${!ok && note ? ` (${note})` : ""}`);
}
if (has("DEV_USER")) console.log(`\nDEV_USER is set: locally you're signed in as ${env.DEV_USER} without Google (ignored in production).`);
