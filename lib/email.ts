// Sending email (sign-in links and invites) through Resend's API. Server-only, optional: see docs/people.md.
// RESEND_API_URL points it at a stand-in for local testing; leave it unset.
import { EMAIL_FROM, RESEND_KEY } from "./config";

export async function sendEmail(m: { to: string; subject: string; text: string; html: string }) {
  if (!RESEND_KEY || !EMAIL_FROM) throw new Error("Email isn't set up (AUTH_RESEND_KEY and EMAIL_FROM).");
  const r = await fetch(`${(process.env.RESEND_API_URL ?? "https://api.resend.com").replace(/\/$/, "")}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
