"use client";
// Settings → People (admins): who can get in, inviting people from outside the company (an agency, a freelancer),
// roles, and taking access away.
import { useCallback, useEffect, useState } from "react";
import brand from "@/brand.config";
import type { Me } from "@/lib/types";

type Member = {
  email: string;
  name: string | null;
  role: "admin" | "member";
  kind: "env" | "company" | "invited";
  invited_by: string | null;
  invited_at: string | null;
  note: string | null;
  blocked: boolean;
  first_seen: string | null;
  last_seen: string | null;
};

const field = "rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-accent";
const ghost = "rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-white/65 transition hover:border-accent hover:text-accent disabled:opacity-40";
const solid = "rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-110 disabled:opacity-40";
const pill = (c: string) => `rounded-full px-2 py-0.5 text-[10.5px] font-medium ${c}`;

const seen = (iso: string | null) => {
  if (!iso) return null;
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return "active just now";
  if (s < 86400) return `active ${Math.floor(s / 3600)}h ago`;
  return `active ${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
};

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copy this invite link:", text);
    return false;
  }
}

export default function People({ me, domains, emailSignin }: { me: Me; domains: string[]; emailSignin: boolean }) {
  const [list, setList] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/members", { cache: "no-store" });
    if (r.ok) setList((await r.json()).members);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const domainText = domains.length ? domains.map((d) => `@${d}`).join(", ") : "";
  const external = (e: string) => !!e.includes("@") && !domains.includes(e.split("@")[1]?.toLowerCase() ?? "");

  const sendInvite = async () => {
    setBusy("invite");
    setMsg(null);
    const r = await fetch("/api/members", { method: "POST", body: JSON.stringify({ email, role, note }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: j.error ?? "Couldn't invite them." });
    const copied = j.emailed ? false : await copy(j.invite_url);
    setMsg({
      ok: true,
      text: j.emailed
        ? `Invited ${j.email}. They got an email with a link to sign in.`
        : `Invited ${j.email}. ${copied ? "Their invite link is copied" : "Here's their invite link"}: send it to them however you like.`,
      link: j.invite_url,
    });
    setEmail("");
    setNote("");
    setRole("member");
    load();
  };

  const act = async (m: Member, body: object, label: string) => {
    setBusy(`${label}:${m.email}`);
    const r = await fetch(`/api/members/${encodeURIComponent(m.email)}`, { method: "PATCH", body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) alert(j.error ?? "That didn't work.");
    load();
  };

  const inviteLink = async (m: Member) => {
    setBusy(`link:${m.email}`);
    const r = await fetch(`/api/members/${encodeURIComponent(m.email)}`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return alert(j.error ?? "Couldn't make a link.");
    if (!j.emailed) await copy(j.invite_url);
    setMsg({ ok: true, text: j.emailed ? `Sent ${m.email} a fresh invite email.` : `Copied ${m.email}'s invite link.`, link: j.invite_url });
  };

  const active = (list ?? []).filter((m) => !m.blocked);
  const removed = (list ?? []).filter((m) => m.blocked);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-white/70">
        {domainText ? (
          <>
            Anyone with an <span className="text-white">{domainText}</span> Google account{emailSignin ? " or email" : ""} can sign in.{" "}
          </>
        ) : (
          <span className="text-amber-300">No company domain is set (ALLOWED_EMAIL_DOMAINS), so only invited people can sign in. </span>
        )}
        Invite anyone else here, like an agency or a freelancer. They sign in {emailSignin ? "with Google or an email link" : "with a Google account for that email"}, and you can take their access away at any time.
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/30 p-3">
        <div className="flex flex-wrap gap-2">
          <input className={`${field} min-w-[220px] flex-1`} type="email" placeholder="name@agency.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && email && sendInvite()} />
          <input className={`${field} w-[200px]`} placeholder="Note (e.g. Agency: Brightside)" value={note} onChange={(e) => setNote(e.target.value)} />
          <select className={field} value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")} title="Admins connect X, manage people, and post and schedule">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button type="button" className={solid} disabled={!email.includes("@") || busy === "invite"} onClick={sendInvite}>
            {busy === "invite" ? "Inviting…" : "Invite"}
          </button>
        </div>
        <div className="text-[11px] text-white/40">
          Members write drafts, comment, suggest edits and approve.{" "}
          {brand.publishing.whoCanPublish === "admins" ? "Admins also post and schedule, connect X and manage people." : "Admins also connect X and manage people."}
          {email && external(email) && !emailSignin && " This address is outside your company: they'll need a Google account for it (any email can be one, at accounts.google.com/signup)."}
        </div>
        {msg && (
          <div className={`text-xs ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>
            {msg.text}
            {msg.link && (
              <code className="mt-1 block truncate rounded bg-white/5 px-2 py-1 text-[11px] text-white/60" title={msg.link}>
                {msg.link}
              </code>
            )}
          </div>
        )}
      </div>

      {!list && <div className="text-xs text-white/40">Loading people…</div>}
      <div className="flex flex-col divide-y divide-white/[0.06]">
        {active.map((m) => {
          const you = m.email === me.email;
          return (
            <div key={m.email} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white/80">{(m.name ?? m.email)[0]?.toUpperCase()}</span>
              <div className="min-w-[220px] flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="truncate text-white/90">{m.name ?? m.email}</span>
                  {m.role === "admin" && <span className={pill("bg-accent/15 text-accent")}>Admin</span>}
                  {m.kind === "invited" && <span className={pill("bg-violet-400/15 text-violet-300")}>Guest</span>}
                  {m.kind === "invited" && !m.last_seen && <span className={pill("bg-amber-400/15 text-amber-300")}>Hasn&apos;t signed in yet</span>}
                  {you && <span className="text-[11px] text-white/40">you</span>}
                </div>
                <div className="truncate text-[11.5px] text-white/40">
                  {[m.name ? m.email : null, m.note, m.kind === "invited" && m.invited_by ? `invited by ${m.invited_by}` : null, m.kind === "env" ? "admin from ADMIN_EMAILS" : null, seen(m.last_seen)].filter(Boolean).join(" · ")}
                </div>
              </div>
              {m.kind !== "env" && !you && (
                <div className="flex flex-wrap gap-1.5">
                  {m.kind === "invited" && (
                    <button type="button" className={ghost} disabled={!!busy} onClick={() => inviteLink(m)} title={emailSignin ? "Email them a fresh invite (and copy its link)" : "Copy their invite link"}>
                      {emailSignin ? "Resend invite" : "Copy invite link"}
                    </button>
                  )}
                  <button type="button" className={ghost} disabled={!!busy} onClick={() => act(m, { role: m.role === "admin" ? "member" : "admin" }, "role")}>
                    {m.role === "admin" ? "Make member" : "Make admin"}
                  </button>
                  <button
                    type="button"
                    className={`${ghost} hover:!border-rose-400/60 hover:!text-rose-300`}
                    disabled={!!busy}
                    onClick={() => confirm(`Remove ${m.email}'s access to ${brand.name}? They're signed out on their next click. You can give it back later.`) && act(m, { blocked: true }, "remove")}
                  >
                    Remove access
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {removed.length > 0 && (
        <div className="flex flex-col gap-1">
          <button type="button" className="self-start text-[11px] text-white/40 hover:text-white/70" onClick={() => setShowRemoved((x) => !x)}>
            {showRemoved ? "▾" : "▸"} Removed · {removed.length}
          </button>
          {showRemoved &&
            removed.map((m) => (
              <div key={m.email} className="flex items-center gap-3 py-1.5 text-sm text-white/45">
                <span className="min-w-0 flex-1 truncate">
                  {m.name ? `${m.name} · ` : ""}
                  {m.email}
                  {m.note ? ` · ${m.note}` : ""}
                </span>
                <button type="button" className={ghost} disabled={!!busy} onClick={() => act(m, { blocked: false }, "restore")}>
                  Give access back
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
