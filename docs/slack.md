# Slack notifications (optional)

With Slack on, people get a DM from your own Slack app when something happens on a draft they're part of:

- a comment on their draft, a reply in a thread they're in, or an @tag in any comment
- a suggested edit on their draft, and whether their own suggestion was accepted
- an approval, a "needs work" or a kill on their draft (admins also hear about approvals: they post them)
- a teammate's new draft (admins), once it has words in it
- their post going live on X, or failing to

Nobody is told about their own actions.

## Set it up

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From a manifest**, pick your workspace, and
   paste `docs/slack-app-manifest.yml` (rename it if you like).
2. **Install to Workspace**, then copy the **Bot User OAuth Token** (starts with `xoxb-`).
3. Find each person's Slack member ID: their profile → ⋯ → **Copy member ID**.
4. Add to Vercel (and `.env.local` for local testing):

| Name | Value |
|---|---|
| `SLACK_BOT_TOKEN` | the `xoxb-` token |
| `SLACK_USERS` | `ana@acme.com=U01ABCDEF,ben@acme.com=U02GHIJKL` (the emails they sign in with) |

5. Redeploy, then Settings → **Send me a test DM**.

Only people in `SLACK_USERS` get DMs and can be @tagged in comments.
