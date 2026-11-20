import { redirect } from "next/navigation";
import SignInCard from "@/components/SignInCard";
import { currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;
  return <SignInCard error={error} />;
}
