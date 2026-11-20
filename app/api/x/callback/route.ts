// X sends the admin back here after they approve (or cancel) the connection.
import { NextResponse } from "next/server";
import { open } from "@/lib/crypto";
import { finishConnect } from "@/lib/x/account";
import { APP_URL } from "@/lib/config";
import { currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const back = (x: string, detail?: string) => {
    const res = NextResponse.redirect(`${APP_URL}/?settings=1&x=${x}${detail ? `&detail=${encodeURIComponent(detail.slice(0, 300))}` : ""}`);
    res.cookies.set("x_oauth", "", { path: "/api/x", maxAge: 0 });
    return res;
  };
  const u = await currentUser();
  if (!u || u.role !== "admin") return back("admins-only");
  if (sp.get("error")) return back("cancelled", sp.get("error_description") ?? sp.get("error") ?? undefined);
  const raw = req.headers.get("cookie")?.match(/(?:^|;\s*)x_oauth=([^;]+)/)?.[1];
  let saved: { state: string; verifier: string; by: string } | null = null;
  try {
    saved = raw ? JSON.parse(open(decodeURIComponent(raw))) : null;
  } catch {
    saved = null;
  }
  if (!saved || saved.state !== sp.get("state") || saved.by !== u.email) return back("expired");
  try {
    await finishConnect(sp.get("code") ?? "", saved.verifier, u.email);
    return back("connected");
  } catch (e) {
    return back("failed", (e as Error).message);
  }
}
