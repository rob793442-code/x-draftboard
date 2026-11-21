# Google sign-in

People sign in with their Google account. Only your company domain(s) and people an admin invited get in; the check
runs on the server on every request.

## 1. Create the OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com) signed in with your work account, and pick or create
   a project (e.g. "Internal tools").
2. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding / Audience):
   - App name: your board's name. Support email: yours. Leave the logo empty (adding one triggers Google's brand review).
   - **Audience: External**, then **Publish app** (status "In production"). Draftboard decides who gets in (your
     domains plus the people admins invite), so Google only has to confirm who someone is. Sign-in only asks for
     `openid`, `email` and `profile`, which need no review from Google.
     - Choose **Internal** only if no one outside your Google Workspace will ever need access: Internal turns away
       agencies and freelancers at Google's door, even after you invite them.
     - In "Testing" status only the test users you list in Google's console can sign in, so publish it.
   - Scopes: the defaults (`openid`, `email`, `profile`) are all it needs.
3. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized JavaScript origins: `https://YOUR-DOMAIN` (and `http://localhost:3000` for local testing)
   - Authorized redirect URIs: `https://YOUR-DOMAIN/api/auth/callback/google`
     (and `http://localhost:3000/api/auth/callback/google`)
4. Copy the client ID and client secret.

## 2. Add the settings

| Name | Value |
|---|---|
| `AUTH_GOOGLE_ID` | the client ID |
| `AUTH_GOOGLE_SECRET` | the client secret |
| `AUTH_SECRET` | a long random string: `openssl rand -base64 32` (also encrypts the X tokens) |
| `ALLOWED_EMAIL_DOMAINS` | your domain(s), comma-separated: `acme.com,acme.co.uk`. Everyone on them can sign in. |
| `ADMIN_EMAILS` | the first admins: `ana@acme.com`. They can add more admins in the app. |
| `ALLOWED_EMAILS` | optional. Usually leave empty and invite outside people from Settings → People instead. |

Add them in Vercel (Production), and in `.env.local` if you want to test real Google sign-in locally. Redeploy.

People outside your domains (an agency, a freelancer): an admin invites them in **Settings → People**. They can also
sign in with an email link instead of Google if you set that up. See [people.md](people.md).

## Roles

- **Everyone who can sign in**: writes drafts, comments, suggests edits, approves / sends back / kills drafts.
- **The draft's writer**: edits it directly, accepts or rejects suggestions on it.
- **Admins**: all of that on any draft, plus connect X, invite and remove people, delete and reorder drafts, and (by
  default) post and schedule.
  Change who posts in `brand.config.ts` → `publishing.whoCanPublish`.
