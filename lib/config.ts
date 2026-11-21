// Server-side settings from environment variables (see .env.example). Brand and folders are in brand.config.ts.
import brand from "@/brand.config";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** The site's public address, no trailing slash (share links, Slack links, the X sign-in callback). */
export const APP_URL = (process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, "");

/** Google accounts on these domains can sign in (e.g. "acme.com,acme.co.uk"). */
export const ALLOWED_DOMAINS = list(process.env.ALLOWED_EMAIL_DOMAINS);

/** Extra individual Google accounts allowed in, outside those domains (contractors, an agency). */
export const ALLOWED_EMAILS = list(process.env.ALLOWED_EMAILS);

/** Admins: connect the X account, delete and rearrange drafts, edit any draft, and (by default) post and schedule. */
export const ADMIN_EMAILS = list(process.env.ADMIN_EMAILS);

/** On a company domain, or listed by email in the environment. Invited people are checked in lib/members.ts. */
export const inCompany = (email: string) => {
  const e = email.toLowerCase();
  return ALLOWED_EMAILS.includes(e) || ADMIN_EMAILS.includes(e) || ALLOWED_DOMAINS.includes(e.split("@")[1] ?? "");
};

/** Email sign-in links and invite emails, sent through Resend (resend.com). Optional: without them, people sign in
 *  with Google and admins copy invite links by hand. */
export const RESEND_KEY = process.env.AUTH_RESEND_KEY?.trim() ?? "";
export const EMAIL_FROM = process.env.EMAIL_FROM?.trim() ?? "";
export const EMAIL_ON = !!(RESEND_KEY && EMAIL_FROM);

/** X app credentials (developer.x.com). Without them the Connect X button explains what's missing. */
export const X_CLIENT_ID = process.env.X_CLIENT_ID?.trim() ?? "";
export const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET?.trim() ?? "";
export const X_CALLBACK_URL = `${APP_URL}/api/x/callback`;

/** Media storage: Vercel Blob when its token is set, otherwise files on disk (local development only). */
export const STORAGE: "blob" | "local" = process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";

export { brand };
