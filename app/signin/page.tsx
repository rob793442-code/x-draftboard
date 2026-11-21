import { redirect } from "next/navigation";
import SignInCard from "@/components/SignInCard";
import { inviteByToken } from "@/lib/members";
import { currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; invite?: string; sent?: string; type?: string }> }) {
  if (await currentUser()) redirect("/");
  // ?sent=1 from our own redirect, ?type=email when Auth.js forwards its "check your email" step here
  const { error, invite, sent, type } = await searchParams;
  const inv = invite ? await inviteByToken(invite).catch(() => null) : null;
  return <SignInCard error={error} invite={inv} sent={!!sent || type === "email"} />;
}
