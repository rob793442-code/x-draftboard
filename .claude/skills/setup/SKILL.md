---
name: setup
description: Set up this Draftboard for a team, step by step - make it theirs (brand name, colors, logo, font, folders), run it locally, deploy it to Vercel with a database and media storage, lock sign-in to the company's Google accounts, connect the company X account for posting and scheduling, turn on the scheduler, and optionally Slack. Use when someone has just cloned or forked this repo, asks to set it up, deploy it, rebrand it, change its colors or folders, restrict who can sign in, connect X, fix scheduling, or add Slack. Any step can run on its own.
---

# Set up Draftboard

You're helping someone turn this repo into their team's own drafts board. Work through the steps below in order,
one at a time. Each step says what you do and what only they can do. Keep it conversational: a short explanation,
one or two questions at a time, then do the work and show the result.

If they asked for one thing ("just rebrand it", "connect X", "scheduling isn't working"), jump to that step. Run
`npm run check:setup` first to see what's already done and skip those steps.

## Ground rules (read before starting)

- **Secrets never pass through the chat.** Client secrets, tokens, database URLs and `AUTH_SECRET` are pasted by the
  person into Vercel (Project → Settings → Environment Variables) or into `.env.local` in their own editor. If they
  paste one into the chat anyway, don't repeat it; tell them to rotate it if the chat is shared, and carry on.
  You may generate a random secret straight into `.env.local` with a shell command that doesn't print it, e.g.
  `printf 'AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >> .env.local`.
- Ask before anything that costs money or is public: buying X credits, posting to X, making a repo public,
  upgrading a Vercel plan.
- Read the matching file in `docs/` before each step; it has the exact settings and the why. Don't paraphrase it from
  memory.
- After each step, say in one line what's done and what's next.

## Step 1. Make it theirs (branding)

Ask, all at once:
1. What should the board be called? (Default: "<Company> Drafts".)
2. Company name, and the X handle you'll post from.
3. Your website (or a brand guide / hex colors), so the board can use your colors and logo.
4. What folders should drafts go in? Offer examples: content pillars ("Education", "Product", "Community"), or formats
   ("Threads", "Single posts", "Launches"). Any labels (products, campaigns)? Fine to keep the defaults.
5. Posting rules: should a draft need an approval before it posts (recommended: yes)? Who posts: admins only
   (recommended) or everyone?

Then:
- If they gave a website, fetch it (WebFetch, or the firecrawl skill if it's installed) and pull the brand color
  (look at `<meta name="theme-color">`, CSS custom properties, the main button color) and the logo (an SVG/PNG in
  the header, `apple-touch-icon`, or the favicon). Show them the colors you picked and ask before using them. Never
  edit or recolor their logo file; use it as-is.
- The board is dark (like X dark mode). Check `accent` has at least 4.5:1 contrast against black; if their brand color
  is too dark, use a lighter tint of it for `accent` and keep the true color for `primary`, and say so.
- Edit `brand.config.ts` (name, company, x, logo, colors, folders, labels, publishing). Put the logo in `public/` and
  point `brand.logo` at it. If they want a different font, change `app/fonts.ts` (Google Fonts via `next/font/google`).
- Run `npm run typecheck`.

Reference: `docs/branding.md`.

## Step 2. See it running locally

- `npm install` if `node_modules` is missing (Node 20+).
- Make `.env.local` from `.env.example` with just: `DEV_USER=<their work email>`, `ADMIN_EMAILS=<same>`,
  `ALLOWED_EMAIL_DOMAINS=<their domain>`, and a generated `AUTH_SECRET` (see ground rules). Leave `DATABASE_URL` and
  `BLOB_READ_WRITE_TOKEN` empty: locally it uses a built-in database (`.data/pglite`) and saves uploads to
  `.data/uploads`.
- Start it (`npm run dev`, or the preview tool if you have one) and show them: write a draft, comment on it, approve it.
  Posting needs X (step 5).
- If they want changes to the look, make them now.

## Step 3. Their own repo and Vercel project

Reference: `docs/deploy.md`.

- Check `git remote -v`. If it still points at the original Draftboard repo, offer to create their own (private by
  default): `gh repo create <name> --private --source . --push` (ask for the name; needs the GitHub CLI signed in).
  Commit their branding first.
- They create the Vercel project from that repo (vercel.com/new) and, in the project's **Storage** tab, create and
  connect **Neon Postgres** (adds `DATABASE_URL`) and **Blob** (adds `BLOB_READ_WRITE_TOKEN`). These are clicks in their
  browser; walk them through it. If you have a Vercel CLI or MCP signed in to their account, you can create the
  project and link it (`npx vercel link`) for them, after asking.
- Ask for the production URL once it exists. That's `YOUR-DOMAIN` for steps 4 and 5. If they'll use a custom domain,
  set `APP_URL` to it.

## Step 4. Sign-in for your team only (Google)

Reference: `docs/google-oauth.md`. Walk them through creating the OAuth client in Google Cloud Console, step by step,
with the exact redirect URIs filled in with their URL:
`https://YOUR-DOMAIN/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google`).
Recommend **Audience: Internal** if they're on Google Workspace.

They add in Vercel → Settings → Environment Variables (Production): `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
`AUTH_SECRET` (a new random one for production), `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS`, and optionally
`ALLOWED_EMAILS`. Then redeploy (Deployments → ⋯ → Redeploy, or `npx vercel deploy --prod`).

Check: they can sign in with a work account. If they have a personal Gmail handy, it should be turned away.

## Step 5. Connect X (posting and scheduling)

Reference: `docs/x-api.md`. Explain the cost model first (pay-per-use credits, roughly $0.015 a post and $0.20 for a
post with a link) and that they decide on credits and spending limits; don't push them.

Walk them through: developer app at console.x.com on the Pay Per Use package with credits; User authentication
settings → OAuth 2.0, Web App, Read and write, callback `https://YOUR-DOMAIN/api/x/callback`, website URL. They add
`X_CLIENT_ID` and `X_CLIENT_SECRET` in Vercel and redeploy.

Then, signed in to X **as the company account** in that browser, an admin opens **Settings → Connect X account**.
Settings should show the account. Previews now use its name and avatar.

Don't post a test to the real account unless they ask. If they want a test, suggest scheduling a draft a few minutes
out that they're happy to have public, or using a separate test X account first.

## Step 6. The scheduler

Reference: `docs/scheduling.md`.

- They add `CRON_SECRET` (a long random string) in Vercel and redeploy. `vercel.json` already runs the scheduler every
  15 minutes (Vercel Schedules).
- Ask which plan they're on. Hobby: posts can be up to ~15 minutes late; offer cron-job.org (free, every minute) or the
  GitHub Action in `docs/github-actions-scheduler.yml`. Pro: change the schedule in `vercel.json` to `* * * * *` with
  `"jitter": 1`, commit, push.
- Check: Settings → Scheduler shows a recent "Last run" after the next tick.

## Step 7 (optional). Slack

Reference: `docs/slack.md`. App from `docs/slack-app-manifest.yml`, `SLACK_BOT_TOKEN`, and `SLACK_USERS`
(email=member ID pairs; help them list their team). Redeploy, then Settings → Send me a test DM.

## Finish

Run `npm run check:setup` and go through what's left. Summarize for them:
- the URL, who can sign in, who the admins are
- which X account is connected and how scheduling runs
- where to change things later: `brand.config.ts` for the look, folders and rules; Vercel env vars for people and keys

Suggest they invite one teammate to write a draft and another to review it, to see the whole loop.
