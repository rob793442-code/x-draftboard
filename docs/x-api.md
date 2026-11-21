# Posting to X

An approved draft gets onto X one of two ways. Every draft offers both; `publishing.method` in `brand.config.ts`
decides which one leads.

| | Post it yourself | Through X's API |
|---|---|---|
| Cost | free | about 1.5¢ a post, 20¢ if it has a link |
| How | X's own composer opens with each post filled in; you attach media, post or schedule it on X, then click "I posted it" (or "I scheduled it in X") | the board posts it, now or at the time you pick |
| Threads | one post at a time: paste each post's link and the next one opens as its reply | automatic |
| Needs | someone signed in to X as the company account | an X developer app with credits, connected once by an admin |

`publishing.method`:

- **`"smart"`** (default): posts without links go through the API; posts with a link default to Post it yourself.
  Links are where nearly all the cost is.
- **`"api"`**: everything through the API (fully hands-off).
- **`"manual"`**: never use the API. You can skip the rest of this guide: no X app, no credits.

Post it yourself uses X's official [share links](https://docs.x.com/x-for-websites/post-button/guides/web-intent)
(`x.com/intent/tweet`), which is X's own supported way to fill in its composer. Don't use browser extensions or scripts
that click around x.com for you: X's [automation rules](https://help.x.com/en/rules-and-policies/x-automation) forbid
it and can permanently suspend the account.

## What the API costs (late 2026)

X's API is pay-per-use: you buy credits in the [Developer Console](https://console.x.com) and each request draws them
down. There is no free tier for new developers. At the time of writing:

| Action | Price |
|---|---|
| A post (each post in a thread counts) | about $0.015 |
| A post that contains a link | about $0.20 |
| Alt text on an image | $0.005 |
| Looking up an @handle (the editor's tag check) | about $0.01, cached for 30 days |

Quotes go out as a link to the quoted post (see below), so they're billed as posts with a link. Check
[X's pricing page](https://docs.x.com/x-api/getting-started/pricing) for current numbers. Set `X_CHECK_HANDLES=off` if
you don't want the editor to look up @handles.

**Keeping it in check:**

- Every API button shows what that draft will cost, and Post now asks before spending.
- **Settings → Posting and costs** shows the month's spend, estimated from the price list, and lets an admin set a
  monthly budget. Past it, the board stops using the API until next month (and stops @handle lookups); Post it yourself
  still works.
- Also set a **spending limit in X's Developer Console**: that's the hard stop, and the console's meter is the real one.

Example: about 6 posts a weekday (130 a month), 40% with a link, costs about $11 a month all through the API, or about
$1 with "smart".

## Posting it yourself, step by step

1. Approve the draft, then click **Post it yourself · free** above it.
2. Make sure your browser is signed in to X as the company account.
3. For each post: **Open in X** (the composer opens with the text filled in), drag in the media you downloaded with
   **Download**, paste the alt text, then post it. For a thread, paste each post's link into the box under it once it's
   up: the next post's **Open in X as a reply** then opens as its reply.
4. To schedule instead of posting, use the schedule option in X's composer (on some accounts it needs X Premium), then
   click **I scheduled it in X** and enter the same time. It waits in the Queue marked "in X" and moves to Posted
   once that time passes.
5. Click **I posted it** (with the first post's link, if you have it) so the draft moves to Posted.

Hand-posting has none of the API's limits below: more than one $cashtag is fine.

## Setting up the API

You only need this to have the board post and schedule by itself.

## 1. Create the app

1. Sign in at [console.x.com](https://console.x.com) with the X account that should own the app (ideally the company
   account, or a teammate's account that will stay with the company).
2. Create a project and an app. Make sure the app is on the **Pay Per Use** package and the account has credits: apps
   without it are read-only, and posting fails with a 403.
3. Open the app's **User authentication settings** and set:
   - **OAuth 2.0**: on
   - **Type of app**: Web App (a confidential client)
   - **App permissions**: Read and write
   - **Callback URL / Redirect URI**: `https://YOUR-DOMAIN/api/x/callback`
     (for local testing also add `http://localhost:3000/api/x/callback`). It must match exactly.
   - **Website URL**: your site's address
4. Copy the **OAuth 2.0 Client ID** and **Client Secret** (Keys and tokens). The Settings page in Draftboard shows the
   exact callback URL with a copy button.

X moves menus around; if a name above doesn't match, look for "User authentication", "OAuth 2.0" and "Callback".

## 2. Add the keys

In Vercel → your project → Settings → Environment Variables (Production), add:

| Name | Value |
|---|---|
| `X_CLIENT_ID` | OAuth 2.0 Client ID |
| `X_CLIENT_SECRET` | OAuth 2.0 Client Secret |

Redeploy so the new values are picked up.

## 3. Connect the account

1. Sign in to X **as the company account** in your browser (not your personal account).
2. In Draftboard, an admin opens **Settings → Connect X account** and approves the app on X.
3. Settings now shows the account's name and avatar, and previews use them too.

The tokens are encrypted with `AUTH_SECRET` before they're stored. If you change `AUTH_SECRET`, connect the account
again. If X ever revokes the connection (password change, app permissions changed), Settings → Reconnect.

## What X's API allows (and how Draftboard handles it)

- **Threads**: each post replies to the one before. X only allows replies in your own threads on self-serve plans,
  which is exactly what a thread is.
- **Quotes**: attaching a quote (`quote_tweet_id`) is Enterprise-only, so a quoted post goes out the way X's own
  composer does it: the link to the post at the end of the text, which X shows as the quote card.
- **Video posts** (X's "Post video" from another post) can't be made through the API either; they go out as a quote link.
- **Cashtags**: at most one `$TICKER` per post through the API. The editor flags extra ones.
- **Length**: 280 characters unless the account has X Premium (then up to 25,000). Settings shows which applies.
- **Media**: up to 4 images (5 MB each), or one GIF (15 MB), or one video per post.
- **Failures**: a thread that fails halfway keeps the posts that went out; Retry posts only the rest. Scheduled posts
  retry on their own after rate limits or X outages (3 tries), then show up in the Queue as "Didn't post".
