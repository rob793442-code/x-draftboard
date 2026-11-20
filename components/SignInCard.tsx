// The sign-in card. Server component: the button signs in with Google, then returns to `next`.
import { signIn } from "@/lib/auth";
import { ALLOWED_DOMAINS } from "@/lib/config";
import brand from "@/brand.config";

/** Only same-site paths, so a crafted link can't bounce someone to another site after sign-in. */
const safeNext = (next?: string) => (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");

export default function SignInCard({ next, error }: { next?: string; error?: string }) {
  const to = safeNext(next);
  const domains = ALLOWED_DOMAINS.map((d) => `@${d}`).join(" or ");
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logo} alt="" className="mx-auto mb-4 h-12 w-12 rounded-full" />
        <div className="text-lg font-medium tracking-[-0.02em]">{brand.name}</div>
        <div className="mt-1 text-sm text-white/50">Sign in with your {brand.company} Google account.</div>
        {error && (
          <div className="mt-4 rounded-lg bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
            {error === "AccessDenied" ? `That account can't sign in here.${domains ? ` Use your ${domains} Google login.` : ""}` : "Sign-in didn't work. Try again."}
          </div>
        )}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: to });
          }}
        >
          <button type="submit" className="mt-6 w-full rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-on-primary transition hover:brightness-110">
            Continue with Google
          </button>
        </form>
      </div>
    </div>
  );
}
