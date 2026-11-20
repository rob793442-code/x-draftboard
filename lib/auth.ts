// Google sign-in (Auth.js), limited to your company's email domains (ALLOWED_EMAIL_DOMAINS) plus any individual
// addresses in ALLOWED_EMAILS / ADMIN_EMAILS. The gate is checked server-side on the page and every API route.
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "./config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    signIn({ profile }) {
      return !!profile?.email_verified && !!profile.email && isAllowedEmail(profile.email);
    },
  },
});
