# Connect your X account

Draftboard posts through X's official API, as one company account that an admin connects once. You need an X
developer app with OAuth 2.0 turned on, and API credits.

## What it costs (late 2026)

X's API is pay-per-use: you buy credits in the [Developer Console](https://console.x.com) and each request draws them
down. There is no free tier for new developers. At the time of writing:

| Action | Price |
|---|---|
| A post (each post in a thread counts) | about $0.015 |
| A post that contains a link | about $0.20 |
| Alt text on an image | $0.005 |
| Looking up an @handle (the editor's tag check) | about $0.01, cached for 30 days |

Quotes go out as a link to the quoted post (see below), so they're billed as posts with a link. Set a spending limit
in the console. Check [X's pricing page](https://docs.x.com/x-api/getting-started/pricing) for current numbers.
Set `X_CHECK_HANDLES=off` if you don't want the editor to look up @handles.

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
