"use client";
// The strip above a draft that takes it to X: Post now, Schedule, and what happened (scheduled, posting, live, failed).
import { useEffect, useState } from "react";
import brand from "@/brand.config";
import type { Bundle, Me, XAccount } from "@/lib/types";
import { xLength } from "@/lib/xtext";

const ghost = "rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-white/70";
const solid = "rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-on-primary transition hover:brightness-110 disabled:opacity-40";

/** "Tue, Nov 24, 9:00 AM" in the viewer's own time zone. */
export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return when(iso);
};
const zone = () => new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";

/** <input type="datetime-local"> value for a date, in local time. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
/** The next full hour at least 15 minutes away. */
const nextSlot = () => {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
};

let accountCache: Promise<{ account: XAccount | null; configured: boolean }> | null = null;
function useAccount() {
  const [a, setA] = useState<{ account: XAccount | null; configured: boolean } | null>(null);
  useEffect(() => {
    accountCache ??= fetch("/api/x/account").then((r) => (r.ok ? r.json() : { account: null, configured: false }));
    accountCache.then(setA).catch(() => setA({ account: null, configured: false }));
  }, []);
  return a;
}

export default function PublishBar({ bundle, me, onChanged, onBundle }: { bundle: Bundle; me: Me; onChanged: () => void; onBundle: (b: Bundle) => void }) {
  const acct = useAccount();
  const p = bundle.publish;
  const [picking, setPicking] = useState(false);
  const [at, setAt] = useState(() => localInput(p.scheduled_at ? new Date(p.scheduled_at) : nextSlot()));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPicking(false);
    setErr(null);
    setAt(localInput(bundle.publish.scheduled_at ? new Date(bundle.publish.scheduled_at) : nextSlot()));
  }, [bundle.draft.id, bundle.publish.scheduled_at]);

  // While it's posting (someone else clicked, or the scheduler is on it), check back every few seconds.
  useEffect(() => {
    if (p.state !== "publishing") return;
    const t = setInterval(onChanged, 4000);
    return () => clearInterval(t);
  }, [p.state, onChanged]);

  const call = async (label: string, method: "POST" | "DELETE", body?: unknown) => {
    setBusy(label);
    setErr(null);
    try {
      const r = await fetch(`/api/drafts/${bundle.draft.id}/publish`, { method, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (j.bundle) onBundle(j.bundle);
      else if (r.ok) onBundle(j);
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setPicking(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const account = acct?.account ?? null;
  const handle = account ? `@${account.username}` : `@${brand.x.handle}`;
  const tooLong = account && !account.long_posts ? bundle.draft.posts.findIndex((x) => xLength(x.text) > 280) : -1;

  // Why it can't go out yet (the server checks all of this again).
  const why = !acct
    ? "Checking the X account…"
    : !account
      ? me.role === "admin"
        ? "Connect the X account in Settings to post from here."
        : "No X account is connected yet. An admin can connect one in Settings."
      : brand.publishing.requireApproval && bundle.review_status !== "approved"
        ? "Approve it first, then it can be posted or scheduled."
        : brand.publishing.requireApproval && !bundle.approved_current
          ? "Edited after it was approved. Approve it again to post it."
          : tooLong >= 0
            ? `Post ${tooLong + 1} is over 280 characters. ${handle} needs X Premium to post that.`
            : null;

  const box = "flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm";

  if (p.state === "posted")
    return (
      <div className={`${box} border-white/15 bg-white/[0.04]`}>
        <span className="text-white/85">Live on X{p.posted_at ? ` · ${ago(p.posted_at)}` : ""}</span>
        {p.scheduled_by && <span className="text-white/45">posted by {p.scheduled_by}</span>}
        <span className="flex-1" />
        {p.posted_url && (
          <a className={ghost} href={p.posted_url} target="_blank" rel="noreferrer">
            View on X ↗
          </a>
        )}
      </div>
    );

  if (p.state === "publishing")
    return (
      <div className={`${box} border-violet-400/30 bg-violet-400/[0.06]`}>
        <span className="animate-pulse text-violet-200">Posting to {handle}…</span>
        <span className="text-white/45">Videos can take a minute while X processes them.</span>
      </div>
    );

  const picker = picking && (
    <div className="flex w-full flex-wrap items-center gap-2 pt-1">
      <input
        type="datetime-local"
        value={at}
        min={localInput(new Date())}
        onChange={(e) => setAt(e.target.value)}
        className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent [color-scheme:dark]"
      />
      <span className="text-xs text-white/40">{zone()}</span>
      <button type="button" className={solid} disabled={!!busy || !at} onClick={() => call("Scheduling…", "POST", { when: new Date(at).toISOString() })}>
        {busy === "Scheduling…" ? busy : p.state === "scheduled" ? "Move it" : "Schedule"}
      </button>
      <button type="button" className={ghost} onClick={() => setPicking(false)}>
        Cancel
      </button>
    </div>
  );

  const postNow = (
    <button
      type="button"
      className={solid}
      disabled={!!busy || !!why}
      title={why ?? `Post it to ${handle} now`}
      onClick={() => confirm(`Post "${bundle.draft.title}" to ${handle} now?${bundle.draft.posts.length > 1 ? ` (${bundle.draft.posts.length} posts in a thread)` : ""}`) && call("Posting…", "POST", { when: "now" })}
    >
      {busy === "Posting…" ? "Posting…" : p.state === "failed" && p.posted_count ? "Finish posting" : p.state === "failed" ? "Retry now" : "Post now"}
    </button>
  );

  if (p.state === "scheduled" || p.state === "failed")
    return (
      <div className={`${box} ${p.state === "failed" ? "border-rose-400/40 bg-rose-400/[0.06]" : "border-violet-400/30 bg-violet-400/[0.06]"}`}>
        {p.state === "scheduled" && p.scheduled_at ? (
          <span className="text-violet-100">
            Scheduled for <span className="font-medium">{when(p.scheduled_at)}</span> on {handle}
            {p.scheduled_by ? <span className="text-white/45"> · by {p.scheduled_by}</span> : null}
          </span>
        ) : (
          <span className="text-rose-200">
            Didn&apos;t post{p.posted_count ? ` (${p.posted_count} of ${bundle.draft.posts.length} posts are live; retrying finishes the thread)` : ""}.
          </span>
        )}
        <span className="flex-1" />
        {me.can_publish && (
          <>
            <button type="button" className={ghost} disabled={!!busy || !!why} onClick={() => setPicking((x) => !x)}>
              {p.state === "scheduled" ? "Change time" : "Reschedule"}
            </button>
            {postNow}
            <button type="button" className={ghost} disabled={!!busy} onClick={() => call("Unscheduling…", "DELETE")}>
              {p.state === "failed" ? "Clear" : "Unschedule"}
            </button>
          </>
        )}
        {p.error && <div className="w-full text-xs text-rose-300">{p.error}</div>}
        {why && <div className="w-full text-xs text-amber-300">{p.state === "scheduled" ? `Heads up: it won't post until this is fixed. ${why}` : why}</div>}
        {err && <div className="w-full text-xs text-rose-300">{err}</div>}
        {picker}
      </div>
    );

  // Not scheduled yet.
  if (!me.can_publish)
    return why || bundle.review_status !== "approved" ? null : (
      <div className={`${box} border-emerald-400/30 bg-emerald-400/[0.05]`}>
        <span className="text-emerald-200">Approved and ready. An admin can post or schedule it.</span>
      </div>
    );

  return (
    <div className={`${box} ${why ? "border-white/10 bg-white/[0.02]" : "border-emerald-400/30 bg-emerald-400/[0.05]"}`}>
      <span className={why ? "text-white/50" : "text-emerald-200"}>{why ?? `Ready to go out on ${handle}.`}</span>
      <span className="flex-1" />
      <button type="button" className={ghost} disabled={!!busy || !!why} onClick={() => setPicking((x) => !x)} title={why ?? "Pick a date and time"}>
        Schedule…
      </button>
      {postNow}
      {err && <div className="w-full text-xs text-rose-300">{err}</div>}
      {picker}
    </div>
  );
}
