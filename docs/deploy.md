# Deploy to Vercel

Draftboard is a standard Next.js app. These steps use Vercel because the uploads use Vercel Blob and the scheduler
uses Vercel Schedules; the database can be any Postgres.

## 1. Your own copy on GitHub

Use **Use this template** (or fork) on GitHub, then clone your copy. Keep your copy private if you like; nothing
secret is ever committed.

## 2. Create the Vercel project

Which plan: Vercel's free Hobby plan is for personal, non-commercial use only, so a company running this should use
**Pro** ($20 a month per member who deploys; teammates who only use the board don't need a Vercel seat). Hobby is fine
for trying it out. If your company already has a Vercel Pro team, put the project there and it costs nothing extra.

1. [vercel.com/new](https://vercel.com/new) → import your repo. Framework: Next.js (detected). Don't deploy yet, or
   let the first deploy fail; it needs the settings below.
2. **Storage → Create → Neon (Postgres)** and connect it to the project. This adds `DATABASE_URL`. (Supabase,
   Railway or any Postgres works too: paste its connection string as `DATABASE_URL`. Prefer a pooled connection string.)
   Tables are created automatically on first use.
3. **Storage → Create → Blob** and connect it. This adds `BLOB_READ_WRITE_TOKEN`.
4. **Settings → Environment Variables**: add everything in `.env.example` that applies (Google sign-in, X, `CRON_SECRET`,
   optional Slack). `DEV_USER` stays out of production.
5. Deploy. Note the production URL; that's `YOUR-DOMAIN` in the Google and X setup. If you add a custom domain, set
   `APP_URL=https://your.domain` and update the Google and X callback URLs.

From the command line instead: `npx vercel link`, then `npx vercel env pull .env.local` to get the values locally,
and `npx vercel deploy --prod`.

## 3. Check it

- Sign in with a work account. Someone outside your domains should be turned away.
- Settings shows what's connected and what's missing. `npm run check:setup` does the same locally.
- Write a draft, approve it, schedule it a few minutes out, and watch the Queue. (That posts for real once X is
  connected; use a test account first if you'd rather.)

Function time: posting a thread with video runs inside the request (up to 300 s, the default with Vercel's Fluid
compute on every plan).
