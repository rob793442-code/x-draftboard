# Google sign-in for your team only

People sign in with their work Google account. Only accounts on your domain(s) get in, enforced on the server.

## 1. Create the OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com) signed in with your work account, and pick or create
   a project (e.g. "Internal tools").
2. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding / Audience):
   - App name: your board's name. Support email: yours.
   - **Audience: Internal** if your company uses Google Workspace. Then only people in your Workspace can even see
     the sign-in screen, on top of the domain check Draftboard does. (Personal Gmail accounts can't pick Internal;
     use External and rely on `ALLOWED_EMAIL_DOMAINS` / `ALLOWED_EMAILS`.)
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
| `ALLOWED_EMAIL_DOMAINS` | your domain(s), comma-separated: `acme.com,acme.co.uk` |
| `ALLOWED_EMAILS` | optional extra people outside those domains: `freelancer@gmail.com` |
| `ADMIN_EMAILS` | who's an admin: `ana@acme.com,ben@acme.com` |

Add them in Vercel (Production), and in `.env.local` if you want to test real Google sign-in locally. Redeploy.

## Roles

- **Everyone who can sign in**: writes drafts, comments, suggests edits, approves / sends back / kills drafts.
- **The draft's writer**: edits it directly, accepts or rejects suggestions on it.
- **Admins**: all of that on any draft, plus connect X, delete and reorder drafts, and (by default) post and schedule.
  Change who posts in `brand.config.ts` → `publishing.whoCanPublish`.
