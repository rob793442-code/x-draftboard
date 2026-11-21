// Who can get in, and who's an admin. Server-only.
//
// Anyone on a company domain (ALLOWED_EMAIL_DOMAINS) can sign in from day one. Admins invite everyone else (an agency,
// a freelancer) from Settings → People; the invite is stored here, so that person gets in every time they sign in,
// with Google or an email link, whatever their email domain. Admins can also remove anyone's access (takes effect on
// their next click, not when their session expires) and make people admins.
//
// ADMIN_EMAILS and ALLOWED_EMAILS in the environment still work and always win: the first admins come from there.
import { randomBytes } from "node:crypto";
import { sql } from "./db";
import { ADMIN_EMAILS, APP_URL, ALLOWED_EMAILS, EMAIL_ON, brand, inCompany } from "./config";
import { sendEmail } from "./email";

export type Access = { role: "admin" | "member"; external: boolean };

export type Member = {
  email: string;
  name: string | null;
  role: "admin" | "member";
  /** "env" = an admin from ADMIN_EMAILS (can't be changed here), "company" = on a company domain, "invited" = outside it */
  kind: "env" | "company" | "invited";
  invited_by: string | null;
  invited_at: string | null;
  note: string | null;
  blocked: boolean;
  first_seen: string | null;
  last_seen: string | null;
};

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : ((v as string | null) ?? null));
const clean = (email: string) => email.trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether this person may use the board, and as what. Null = no access. */
export async function accessFor(email: string): Promise<(Access & { last_seen: string | null }) | null> {
  const e = clean(email);
  const envAdmin = ADMIN_EMAILS.includes(e);
  const [m] = await sql`select role, invited, blocked, last_seen from members where email = ${e}`;
  if (m?.blocked && !envAdmin) return null;
  const company = inCompany(e);
  if (!company && !m?.invited) return null;
  return { role: envAdmin || m?.role === "admin" ? "admin" : "member", external: !company, last_seen: iso(m?.last_seen) };
}

/** Called on sign-in, and now and then while someone uses the board: keeps "last seen" for the People list. */
export async function recordSeen(email: string, name?: string | null) {
  const e = clean(email);
  await sql`insert into members (email, name, first_seen, last_seen) values (${e}, ${name ?? null}, now(), now())
    on conflict (email) do update set last_seen = now(), first_seen = coalesce(members.first_seen, now()),
      name = coalesce(${name ?? null}, members.name)`;
}

/** Everyone who can get in or has been in: env admins, people who've signed in, invited people. */
export async function listMembers(): Promise<Member[]> {
  const rows = await sql`select * from members order by blocked, coalesce(last_seen, invited_at) desc nulls last, email`;
  const out: Member[] = rows.map((r) => {
    const email = r.email as string;
    const env = ADMIN_EMAILS.includes(email);
    return {
      email,
      name: (r.name as string) ?? null,
      role: env || r.role === "admin" ? "admin" : "member",
      kind: env ? "env" : inCompany(email) ? "company" : "invited",
      invited_by: (r.invited_by as string) ?? null,
      invited_at: iso(r.invited_at),
      note: (r.note as string) ?? null,
      blocked: !!r.blocked && !env,
      first_seen: iso(r.first_seen),
      last_seen: iso(r.last_seen),
    };
  });
  for (const a of ADMIN_EMAILS)
    if (!out.some((m) => m.email === a)) out.unshift({ email: a, name: null, role: "admin", kind: "env", invited_by: null, invited_at: null, note: null, blocked: false, first_seen: null, last_seen: null });
  return out;
}

/** Every admin's email (for "a draft was approved" and "new draft" messages). */
export async function adminEmails(): Promise<string[]> {
  const rows = await sql`select email from members where role = 'admin' and not blocked`;
  return [...new Set([...ADMIN_EMAILS, ...rows.map((r) => r.email as string)])];
}

export const inviteUrl = (token: string) => `${APP_URL}/signin?invite=${token}`;

/** Admins: let someone in (anyone, usually someone outside the company domains) and, if email is set up, tell them. */
export async function invite(by: { name: string; email: string }, input: { email: string; role?: string; note?: string }) {
  const email = clean(input.email ?? "");
  if (!EMAIL_RE.test(email)) throw new Error("That doesn't look like an email address.");
  const role = input.role === "admin" ? "admin" : "member";
  const note = input.note?.trim().slice(0, 120) || null;
  const token = randomBytes(12).toString("base64url");
  const [r] = await sql`insert into members (email, role, invited, invited_by, invited_at, invite_token, note, blocked)
    values (${email}, ${role}, true, ${by.name}, now(), ${token}, ${note}, false)
    on conflict (email) do update set invited = true, blocked = false, role = excluded.role, invited_by = excluded.invited_by,
      invited_at = now(), invite_token = coalesce(members.invite_token, excluded.invite_token), note = coalesce(excluded.note, members.note)
    returning invite_token, last_seen`;
  const url = inviteUrl(r.invite_token as string);
  const emailed = EMAIL_ON ? await sendInvite(by.name, email, url).then(() => true, (e) => (console.error("invite email failed:", (e as Error).message), false)) : false;
  return { email, invite_url: url, emailed, already_in: !!r.last_seen, external: !inCompany(email) };
}

async function sendInvite(from: string, to: string, url: string) {
  const subject = `${from} invited you to ${brand.name}`;
  const text = `${from} invited you to ${brand.name}, where ${brand.company} writes and reviews its posts for X.\n\nSign in here: ${url}\n\nUse this email address (${to}) to sign in, with Google or an email link.`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
<p style="font-size:16px">${esc(from)} invited you to <b>${esc(brand.name)}</b>, where ${esc(brand.company)} writes and reviews its posts for X.</p>
<p><a href="${url}" style="display:inline-block;background:${brand.colors.primary};color:${brand.colors.onPrimary};padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Open ${esc(brand.name)}</a></p>
<p style="font-size:13px;color:#555">Sign in as ${esc(to)}, with Google or an email link.</p></div>`;
  await sendEmail({ to, subject, text, html });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Who an invite link is for (the sign-in page greets them with it). */
export async function inviteByToken(token: string): Promise<{ email: string; invited_by: string | null } | null> {
  if (!token) return null;
  const [r] = await sql`select email, invited_by from members where invite_token = ${token} and invited and not blocked`;
  return r ? { email: r.email as string, invited_by: (r.invited_by as string) ?? null } : null;
}

/** A fresh invite link (and email, if set up) for someone already invited. */
export async function reinvite(by: { name: string }, email: string) {
  const e = clean(email);
  const [r] = await sql`select invite_token, invited, blocked from members where email = ${e}`;
  if (!r) throw new Error("They aren't on the list. Invite them first.");
  if (r.blocked) throw new Error("Their access was removed. Give it back first.");
  const token = (r.invite_token as string) ?? randomBytes(12).toString("base64url");
  if (!r.invite_token) await sql`update members set invite_token = ${token} where email = ${e}`;
  const url = inviteUrl(token);
  const emailed = EMAIL_ON ? await sendInvite(by.name, e, url).then(() => true, () => false) : false;
  return { email: e, invite_url: url, emailed };
}

export async function setRole(email: string, role: "admin" | "member", me: string) {
  const e = clean(email);
  if (ADMIN_EMAILS.includes(e)) throw new Error("This admin is set in ADMIN_EMAILS; change it there.");
  if (e === me && role !== "admin") throw new Error("You can't remove your own admin role. Ask another admin.");
  const done = await sql`update members set role = ${role} where email = ${e} returning email`;
  if (!done.length) throw new Error("They haven't signed in or been invited yet.");
}

/** Takes someone's access away (blocked), or gives it back. */
export async function setBlocked(email: string, blocked: boolean, me: string) {
  const e = clean(email);
  if (ADMIN_EMAILS.includes(e)) throw new Error("This admin is set in ADMIN_EMAILS; remove them there.");
  if (e === me) throw new Error("You can't remove yourself.");
  if (blocked && ALLOWED_EMAILS.includes(e)) throw new Error("This person is listed in ALLOWED_EMAILS; remove them there.");
  await sql`insert into members (email, blocked) values (${e}, ${blocked}) on conflict (email) do update set blocked = excluded.blocked`;
}
