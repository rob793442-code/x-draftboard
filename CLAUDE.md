# Draftboard: notes for Claude

A team drafts board for X. People write posts and threads, teammates review them (comments on highlighted words,
tracked-change suggestions, approve / needs work / kill), and admins post or schedule approved drafts to the
company's X account. Next.js 15 (App Router) + Tailwind 3, Postgres, Vercel Blob, Auth.js (Google), X API v2.

## When someone opens this repo

If the person is setting the board up for their team (they just cloned or forked it, `brand.config.ts` still says
`name: "Draftboard"`, or they ask to set it up, deploy it, rebrand it, connect X, or similar), use the **setup** skill
(`.claude/skills/setup/SKILL.md`). It runs as a series of short steps; any step can run on its own ("just the
branding", "connect X"). Offer it once; don't push it on someone who's here to change code.

## Rules

- **Never ask for secrets in chat and never type them yourself.** Client secrets, tokens, `AUTH_SECRET`, database
  URLs: the person pastes them into Vercel (Project → Settings → Environment Variables) or into `.env.local` in their
  own editor. You can generate a random secret in a shell command whose output goes straight into a file the person
  owns (e.g. appending `CRON_SECRET=$(openssl rand -hex 32)` to `.env.local`), but don't print it back.
- Don't post to the real X account to "test" without the person's explicit go-ahead: every post is public and billed.
  The local fake-X test below covers the posting code.
- Keep the brand in `brand.config.ts`, `app/fonts.ts` and `public/`. Don't hard-code a company name, handle, color or
  logo anywhere else.
- Schema changes: edit `lib/schema.ts` (statements must be safe to run twice, e.g. `add column if not exists`) and bump
  `SCHEMA_VERSION`. It's applied automatically on the next request.

## Map

| Where | What |
|---|---|
| `brand.config.ts` | Name, company, X handle placeholder, logo, colors, folders, labels, publishing rules |
| `app/fonts.ts` | UI font (next/font) |
| `lib/config.ts` | Env-driven settings: `APP_URL`, allowed domains/emails, admins, X keys, email, storage mode |
| `lib/members.ts` | Who gets in: company domains + invited guests (`members` table), roles, remove/restore, invite links and emails. `accessFor()` runs on every request |
| `lib/auth.ts`, `lib/auth-adapter.ts`, `lib/email.ts` | Auth.js: Google always; email sign-in links (Resend) only when `AUTH_RESEND_KEY` + `EMAIL_FROM` are set, with a small DB adapter |
| `lib/db.ts`, `lib/schema.ts` | Postgres via `postgres` (any provider), or PGlite in `.data/pglite` when `DATABASE_URL` is unset in dev. `sql\`...\`` returns rows; `tx([q\`...\`])` for transactions; cast arrays: `any(${ids}::text[])` |
| `lib/store.ts` | Drafts, comments, suggestions, verdicts, versions, share links, drag-and-drop order |
| `lib/publish.ts` | Post now / schedule / unschedule, the scheduler tick (`runDue`), approval fingerprint check, thread resume |
| `lib/x/account.ts` | OAuth 2.0 PKCE connect flow, encrypted token storage (`lib/crypto.ts`, key from `AUTH_SECRET`), refresh with compare-and-swap |
| `lib/x/api.ts` | `POST /2/tweets`, chunked media upload (`/2/media/upload/initialize|append|finalize`), alt text |
| `lib/storage.ts` | Vercel Blob or `.data/uploads` (dev); `openMedia()` reads files in ranges for upload to X |
| `lib/notify.ts`, `lib/people.ts` | Optional Slack DMs and @tags (`SLACK_BOT_TOKEN`, `SLACK_USERS`) |
| `app/api/**` | Route handlers. Every one checks `currentUser()` (`lib/user.ts`) |
| `app/api/cron/publish` | Scheduler endpoint, `Authorization: Bearer $CRON_SECRET`; `vercel.json` runs it every 15 min |
| `components/Board.tsx` | Sidebar + views (inbox, queue, posted, folders, draft, settings) |
| `components/Editor.tsx` | The X-style inline editor (autosave, media, @mentions, quotes, threads) |
| `components/ReviewView.tsx` | Comments, suggestions, verdicts, history |
| `components/PublishBar.tsx`, `components/Settings.tsx`, `components/People.tsx` | Posting/scheduling UI; X connect, scheduler and Slack status; inviting and managing people |
| `docs/` | Human setup guides (Google sign-in, X API, deploy, scheduling, Slack, branding) |

Access: everyone on `ALLOWED_EMAIL_DOMAINS`, plus guests an admin invited in Settings → People (stored in `members`),
minus anyone an admin removed. `ADMIN_EMAILS` / `ALLOWED_EMAILS` always win and can't be changed from the app.

Roles: everyone who can sign in writes, comments, suggests and gives verdicts. The writer and admins edit a draft
directly. Admins (`ADMIN_EMAILS`, or made admin in People) connect X, manage people, delete and reorder drafts; by
default only they post and schedule
(`brand.publishing.whoCanPublish`). With `brand.publishing.requireApproval`, a draft must be approved and unchanged
since approval to post (checked again at posting time).

X API facts this code relies on (late 2026, see docs/x-api.md): pay-per-use credits; quote posts via
`quote_tweet_id` are Enterprise-only, so quotes go out as the post link at the end of the text; replies only work in
your own threads (fine for threads); one $cashtag per post; refresh tokens are single-use.

## Commands

```bash
npm run dev          # http://localhost:3000. With DEV_USER set and no DATABASE_URL / BLOB token, needs nothing else
npm run typecheck
npm run build
npm run check:setup  # which env vars and brand settings are still missing
```

Local dev without Google: put `DEV_USER=you@company.com` (plus `ADMIN_EMAILS` with the same address and
`AUTH_SECRET=anything`) in `.env.local`. `DEV_USER` is ignored in production builds.

## Testing the posting code without X

Point the app at a stand-in X: set `X_API_URL=http://127.0.0.1:<port>/2` with `X_CLIENT_ID`/`X_CLIENT_SECRET` set to
anything, run a small HTTP server that answers `/2/oauth2/token`, `/2/users/me`, the media upload endpoints and
`/2/tweets`, then connect through Settings and post. `CRON_SECRET=test` lets you call
`curl -H "Authorization: Bearer test" localhost:3000/api/cron/publish`.
