// Sign-in (Auth.js). Who gets in is decided by lib/members.ts: anyone on a company domain (ALLOWED_EMAIL_DOMAINS), plus
// people an admin invited from Settings → People (an agency, a freelancer). The check runs at sign-in and again on
// every request (lib/user.ts), so removing someone takes effect right away.
//
// Ways to sign in:
//   Google            always (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET)
//   An email link     when email is set up (AUTH_RESEND_KEY + EMAIL_FROM), for people without a Google account
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { EMAIL_FROM, EMAIL_ON, RESEND_KEY, brand } from "./config";
import { dbAdapter } from "./auth-adapter";
import { sendEmail } from "./email";
import { accessFor, recordSeen } from "./members";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const emailLink = Resend({
  apiKey: RESEND_KEY,
  from: EMAIL_FROM,
  maxAge: 30 * 60, // links work for 30 minutes
  async sendVerificationRequest({ identifier, url }) {
    await sendEmail({
      to: identifier,
      subject: `Sign in to ${brand.name}`,
      text: `Sign in to ${brand.name}: ${url}\n\nThe link works once, for 30 minutes. If you didn't ask for it, ignore this email.`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
<p style="font-size:16px">Sign in to <b>${esc(brand.name)}</b></p>
<p><a href="${url}" style="display:inline-block;background:${brand.colors.primary};color:${brand.colors.onPrimary};padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Sign in</a></p>
<p style="font-size:13px;color:#555">The link works once, for 30 minutes. If you didn't ask for it, ignore this email.</p></div>`,
    });
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Google verifies emails, so a Google sign-in may join the record an email link made for the same address.
  providers: [Google({ allowDangerousEmailAccountLinking: true }), ...(EMAIL_ON ? [emailLink] : [])],
  ...(EMAIL_ON ? { adapter: dbAdapter() } : {}),
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin", verifyRequest: "/signin" },
  callbacks: {
    async signIn({ user, profile, email }) {
      // Asking for an email link: only send one to people who have access. Everyone sees the same "check your email"
      // page either way, so the form doesn't reveal who's on the list.
      if (email?.verificationRequest) return (await accessFor(user.email ?? "")) ? true : "/signin?sent=1";
      if (profile && !profile.email_verified) return false;
      return !!(user.email && (await accessFor(user.email)));
    },
  },
  events: {
    async signIn({ user }) {
      if (user.email) await recordSeen(user.email, user.name).catch(() => {});
    },
  },
});
