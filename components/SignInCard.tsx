// The sign-in card. Server component: Google, and (when email is set up) an email link. An invite link
// (/signin?invite=…) greets the person and fills in their email.
import { signIn } from "@/lib/auth";
import { ALLOWED_DOMAINS, EMAIL_ON } from "@/lib/config";
import brand from "@/brand.config";

/** Only same-site paths, so a crafted link can't bounce someone to another site after sign-in. */
const safeNext = (next?: string) => (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");

export default function SignInCard({ next, error, invite, sent }: { next?: string; error?: string; invite?: { email: string; invited_by: string | null } | null; sent?: boolean }) {
  const to = safeNext(next);
  const domains = ALLOWED_DOMAINS.map((d) => `@${d}`).join(" or ");
  const button = "w-full rounded-full px-5 py-2.5 text-sm font-medium transition";
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logo} alt="" className="mx-auto mb-4 h-12 w-12 rounded-full" />
        <div className="text-lg font-medium tracking-[-0.02em]">{brand.name}</div>

        {sent ? (
          <div className="mt-3 text-sm text-white/60">Check your email. If that address has access, a sign-in link is on its way. It works once, for 30 minutes.</div>
        ) : (
          <>
            <div className="mt-1 text-sm text-white/50">
              {invite
                ? `${invite.invited_by ?? "Someone"} invited you. Sign in as ${invite.email}.`
                : domains
                  ? `Sign in with your work account (${domains}), or the email you were invited with.`
                  : "Sign in with the email you were invited with."}
            </div>
            {error && (
              <div className="mt-4 rounded-lg bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
                {error === "AccessDenied"
                  ? `That account doesn't have access.${domains ? ` Use your ${domains} account,` : ""} or ask an admin to invite the email you're signing in with.`
                  : error === "Verification"
                    ? "That sign-in link has expired or was already used. Ask for a new one."
                    : "Sign-in didn't work. Try again."}
              </div>
            )}
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: to });
              }}
            >
              <button type="submit" className={`${button} mt-6 bg-primary text-on-primary hover:brightness-110`}>
                Continue with Google
              </button>
            </form>
            {EMAIL_ON && (
              <form
                className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4"
                action={async (form: FormData) => {
                  "use server";
                  await signIn("resend", { email: String(form.get("email") ?? "").trim().toLowerCase(), redirectTo: to });
                }}
              >
                <input
                  name="email"
                  type="email"
                  required
                  defaultValue={invite?.email ?? ""}
                  placeholder="you@company.com"
                  className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-accent"
                />
                <button type="submit" className={`${button} border border-white/15 text-white/80 hover:border-accent hover:text-accent`}>
                  Email me a sign-in link
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
