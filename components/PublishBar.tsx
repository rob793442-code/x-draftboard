"use client";
// The strip above a draft that takes it to X, two ways:
//   through X's API (Post now / Schedule; costs per post, shown on the buttons)
//   Post it yourself (free): X's own composer opens with each post filled in; you post or schedule it on X, then tell
//   the board. brand.publishing.method decides which one leads; the other is always one click away.
import { useEffect, useState } from "react";
import brand from "@/brand.config";
import type { Bundle, Media, Me, XAccount } from "@/lib/types";
import { parseTweetUrl, textFor, tokenize, xLength } from "@/lib/xtext";
import { apiCost, hasLink, usd } from "@/lib/x/pricing";
import { mediaUrl } from "@/lib/media";

const ghost = "rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-white/70";
const solid = "rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-on-primary transition hover:brightness-110 disabled:opacity-40";
const field = "rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-accent [color-scheme:dark]";

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

/** X's official share link: opens its composer with the text filled in (and as a reply, for the rest of a thread). */
const intentUrl = (text: string, replyTo?: string | null) => `https://x.com/intent/tweet?text=${encodeURIComponent(text)}${replyTo ? `&in_reply_to=${encodeURIComponent(replyTo)}` : ""}`;
/** A link that saves the file instead of opening it (Vercel Blob and the local media route both honor ?download=1). */
const downloadUrl = (m: Media) => {
  const u = mediaUrl(m);
  return `${u}${u.includes("?") ? "&" : "?"}download=1`;
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

function CopyButton({ text, label = "Copy text" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={ghost}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          window.prompt("Copy:", text);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

/** Post it yourself: each post with its X composer link, text to copy and media to download, then "I posted it". */
function HandOff({ bundle, handle, onDone, call, busy }: { bundle: Bundle; handle: string; onDone: () => void; call: (label: string, body: object) => Promise<boolean>; busy: string | null }) {
  const posts = bundle.draft.posts;
  const [links, setLinks] = useState<string[]>(() => posts.map(() => ""));
  const [scheduling, setScheduling] = useState(false);
  const [at, setAt] = useState(() => localInput(nextSlot()));
  const idOf = (i: number) => parseTweetUrl(links[i] ?? "")?.id ?? null;

  return (
    <div className="flex w-full flex-col gap-3 border-t border-white/10 pt-3">
      <div className="text-xs leading-relaxed text-white/55">
        Free, and it&apos;s X&apos;s own way of posting by hand. Be signed in to X as <span className="text-white/80">{handle}</span>.{" "}
        {posts.length > 1
          ? "Post them in order: once a post is up, paste its link under it so the next one opens as a reply and the thread stays together."
          : "Open in X, attach any media, then post it (or schedule it from X's composer) and come back to mark it."}
      </div>
      {posts.map((p, i) => {
        const text = textFor(p);
        const n = xLength(text);
        const needsParent = i > 0 && !idOf(i - 1);
        const cash = tokenize(p.text).filter((t) => t.kind === "cashtag").length;
        return (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/40 p-3">
            <div className="flex items-center gap-2 text-[11px] text-white/45">
              <span className="font-medium text-white/70">{posts.length > 1 ? `Post ${i + 1} of ${posts.length}` : "The post"}</span>
              <span className="font-mono">{n} chars</span>
              {n > 280 && <span className="text-amber-300">over 280: X may ask you to trim it, or paste it with Copy text if the account has Premium</span>}
              {cash > 1 && <span className="text-white/40">({cash} $cashtags is fine when you post by hand)</span>}
            </div>
            <div className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[13.5px] leading-snug text-white/85">{text || <span className="text-white/35">(no text, media only)</span>}</div>
            {!!p.media?.length && (
              <div className="flex flex-wrap items-center gap-2">
                {p.media.map((m, k) => (
                  <div key={k} className="flex items-center gap-2 rounded-lg border border-white/10 p-1.5 pr-2">
                    {m.type === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(m)} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded bg-white/10 text-xs">▶</span>
                    )}
                    <a className={ghost} href={downloadUrl(m)} download>
                      Download
                    </a>
                    {m.alt && <CopyButton text={m.alt} label="Copy alt text" />}
                  </div>
                ))}
                <span className="text-[11px] text-white/40">Drag the file into X&apos;s composer{p.media.some((m) => m.alt) ? " and paste the alt text there" : ""}.</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <a
                className={`${i === 0 || !needsParent ? solid : ghost} ${needsParent ? "pointer-events-none opacity-40" : ""}`}
                href={intentUrl(text, i > 0 ? idOf(i - 1) : null)}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={needsParent}
                title={needsParent ? `Paste the link to post ${i} first, so this one goes out as its reply` : "Opens X's composer with this post filled in"}
              >
                {i > 0 ? "Open in X as a reply ↗" : "Open in X ↗"}
              </a>
              <CopyButton text={text} />
              {posts.length > 1 && i < posts.length - 1 && (
                <input
                  className={`${field} min-w-[240px] flex-1 text-xs`}
                  placeholder={`Paste post ${i + 1}'s link once it's up`}
                  value={links[i]}
                  onChange={(e) => setLinks((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                />
              )}
              {posts.length > 1 && i < posts.length - 1 && links[i] && !idOf(i) && <span className="text-[11px] text-rose-300">That isn&apos;t a link to a post on X.</span>}
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-white/55">Done on X?</span>
        <button
          type="button"
          className={solid}
          disabled={!!busy}
          onClick={async () => {
            const link = links[0]?.trim() || window.prompt("Link to the post on X (optional, so the board can point to it):", "") || "";
            if (await call("Saving…", { manual: "posted", link })) onDone();
          }}
        >
          I posted it
        </button>
        <button type="button" className={ghost} disabled={!!busy} onClick={() => setScheduling((x) => !x)}>
          I scheduled it in X…
        </button>
      </div>
      {scheduling && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="datetime-local" className={field} value={at} onChange={(e) => setAt(e.target.value)} />
          <span className="text-xs text-white/40">{zone()}, the time you picked in X</span>
          <button type="button" className={solid} disabled={!!busy || !at} onClick={async () => (await call("Saving…", { manual: "scheduled", at: new Date(at).toISOString() })) && onDone()}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}

export default function PublishBar({ bundle, me, onChanged, onBundle }: { bundle: Bundle; me: Me; onChanged: () => void; onBundle: (b: Bundle) => void }) {
  const acct = useAccount();
  const p = bundle.publish;
  const [picking, setPicking] = useState(false);
  const [handing, setHanding] = useState(false);
  const [at, setAt] = useState(() => localInput(p.scheduled_at ? new Date(p.scheduled_at) : nextSlot()));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPicking(false);
    setHanding(false);
    setErr(null);
    setAt(localInput(bundle.publish.scheduled_at ? new Date(bundle.publish.scheduled_at) : nextSlot()));
  }, [bundle.draft.id, bundle.publish.scheduled_at]);

  // While it's posting (someone else clicked, or the scheduler is on it), check back every few seconds.
  useEffect(() => {
    if (p.state !== "publishing") return;
    const t = setInterval(onChanged, 4000);
    return () => clearInterval(t);
  }, [p.state, onChanged]);

  const call = async (label: string, body?: object, method: "POST" | "DELETE" = "POST") => {
    setBusy(label);
    setErr(null);
    try {
      const r = await fetch(`/api/drafts/${bundle.draft.id}/publish`, { method, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (j.bundle) onBundle(j.bundle);
      else if (r.ok) onBundle(j);
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setPicking(false);
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const account = acct?.account ?? null;
  const handle = account ? `@${account.username}` : `@${brand.x.handle}`;
  const posts = bundle.draft.posts;
  const cost = apiCost(posts);
  const linked = posts.some(hasLink);
  const method = brand.publishing.method;

  // Why it can't go out at all yet (approval), and why the API route specifically is out (the server checks again).
  const why =
    brand.publishing.requireApproval && bundle.review_status !== "approved"
      ? "Approve it first, then it can be posted or scheduled."
      : brand.publishing.requireApproval && !bundle.approved_current
        ? "Edited after it was approved. Approve it again to post it."
        : null;
  const tooLong = account && !account.long_posts ? posts.findIndex((x) => xLength(textFor(x)) > 280) : -1;
  const cashtags = posts.findIndex((x) => tokenize(x.text).filter((t) => t.kind === "cashtag").length > 1);
  const apiWhy = !acct
    ? "Checking the X account…"
    : method === "manual"
      ? "This board posts by hand only."
      : !account
        ? "No X account is connected for posting through the API."
        : tooLong >= 0
          ? `Post ${tooLong + 1} is over 280 characters; ${handle} needs X Premium for that.`
          : cashtags >= 0
            ? `Post ${cashtags + 1} has more than one $cashtag, which X's API doesn't allow.`
            : null;
  // "smart": posts with a link are free by hand and 20¢ through the API, so hand-posting leads for those
  const lead: "api" | "manual" = apiWhy || method === "manual" || (method === "smart" && linked) ? "manual" : "api";
  const price = `${usd(cost.total)}${cost.posts > 1 ? ` for ${cost.posts} posts` : ""}`;

  const box = "flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm";

  if (p.state === "posted")
    return (
      <div className={`${box} border-white/15 bg-white/[0.04]`}>
        <span className="text-white/85">
          {p.method === "manual" ? "Posted on X by hand" : "Live on X"}
          {p.posted_at ? ` · ${ago(p.posted_at)}` : ""}
        </span>
        {p.scheduled_by && <span className="text-white/45">by {p.scheduled_by}</span>}
        <span className="flex-1" />
        {p.posted_url ? (
          <a className={ghost} href={p.posted_url} target="_blank" rel="noreferrer">
            View on X ↗
          </a>
        ) : (
          me.can_publish && (
            <button
              type="button"
              className={ghost}
              disabled={!!busy}
              onClick={() => {
                const link = window.prompt("Link to the post on X:", "");
                if (link) call("Saving…", { manual: "link", link });
              }}
            >
              Add the link
            </button>
          )
        )}
        {p.method === "manual" && me.can_publish && (
          <button type="button" className={ghost} disabled={!!busy} onClick={() => confirm("Mark this as not posted? It goes back to ready-to-post.") && call("Saving…", { manual: "undo" })}>
            Not posted
          </button>
        )}
        {err && <div className="w-full text-xs text-rose-300">{err}</div>}
      </div>
    );

  if (p.state === "publishing")
    return (
      <div className={`${box} border-violet-400/30 bg-violet-400/[0.06]`}>
        <span className="animate-pulse text-violet-200">Posting to {handle}…</span>
        <span className="text-white/45">Videos can take a minute while X processes them.</span>
      </div>
    );

  if (p.state === "scheduled" && p.method === "manual" && p.scheduled_at)
    return (
      <div className={`${box} border-violet-400/30 bg-violet-400/[0.06]`}>
        <span className="text-violet-100">
          Scheduled in X for <span className="font-medium">{when(p.scheduled_at)}</span>
          {p.scheduled_by ? <span className="text-white/45"> · by {p.scheduled_by}</span> : null}
        </span>
        <span className="text-white/45">It moves to Posted after that time.</span>
        <span className="flex-1" />
        {me.can_publish && (
          <>
            <button type="button" className={ghost} disabled={!!busy} onClick={() => setPicking((x) => !x)}>
              Change time
            </button>
            <button type="button" className={ghost} disabled={!!busy} onClick={() => call("Saving…", { manual: "posted", link: "" })}>
              It&apos;s posted
            </button>
            <button type="button" className={ghost} disabled={!!busy} onClick={() => call("Clearing…", undefined, "DELETE")}>
              Clear
            </button>
          </>
        )}
        {picking && (
          <div className="flex w-full flex-wrap items-center gap-2 pt-1">
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={field} />
            <span className="text-xs text-white/40">{zone()}</span>
            <button type="button" className={solid} disabled={!!busy || !at} onClick={() => call("Saving…", { manual: "scheduled", at: new Date(at).toISOString() })}>
              Save
            </button>
          </div>
        )}
        {err && <div className="w-full text-xs text-rose-300">{err}</div>}
      </div>
    );

  const picker = picking && (
    <div className="flex w-full flex-wrap items-center gap-2 pt-1">
      <input type="datetime-local" value={at} min={localInput(new Date())} onChange={(e) => setAt(e.target.value)} className={field} />
      <span className="text-xs text-white/40">{zone()}</span>
      <button type="button" className={solid} disabled={!!busy || !at} onClick={() => call("Scheduling…", { when: new Date(at).toISOString() })}>
        {busy === "Scheduling…" ? busy : p.state === "scheduled" ? "Move it" : `Schedule · ${usd(cost.total)}`}
      </button>
      <button type="button" className={ghost} onClick={() => setPicking(false)}>
        Cancel
      </button>
    </div>
  );

  const confirmApi = () =>
    confirm(
      `Post "${bundle.draft.title}" to ${handle} now through X's API?\n\nCost: about ${price}${cost.withLink ? ` (${cost.withLink === cost.posts ? "it has a link" : `${cost.withLink} with a link`}, billed at X's link rate)` : ""}.${cost.withLink ? " Posting it yourself is free." : ""}`,
    );

  const postNow = (primary: boolean) => (
    <button type="button" className={primary ? solid : ghost} disabled={!!busy || !!why || !!apiWhy} title={why ?? apiWhy ?? `Post it to ${handle} now through X's API`} onClick={() => confirmApi() && call("Posting…", { when: "now" })}>
      {busy === "Posting…"
        ? "Posting…"
        : p.state === "failed" && p.posted_count
          ? `Finish posting · ${usd(apiCost(posts.slice(p.posted_count)).total)}`
          : p.state === "failed"
            ? `Retry now · ${usd(cost.total)}`
            : `${primary ? "Post now" : "Post now via API"} · ${usd(cost.total)}`}
    </button>
  );

  const handOffButton = (primary: boolean) => (
    <button type="button" className={primary ? solid : ghost} disabled={!!busy || !!why} title={why ?? "Open X's own composer with this filled in, then post or schedule it there. Free."} onClick={() => setHanding((x) => !x)}>
      {handing ? "Hide" : "Post it yourself · free"}
    </button>
  );

  const handOff = handing && !why && (
    <HandOff
      bundle={bundle}
      handle={handle}
      busy={busy}
      call={(label, body) => call(label, body)}
      onDone={() => setHanding(false)}
    />
  );

  if (p.state === "scheduled" || p.state === "failed")
    return (
      <div className={`${box} ${p.state === "failed" ? "border-rose-400/40 bg-rose-400/[0.06]" : "border-violet-400/30 bg-violet-400/[0.06]"}`}>
        {p.state === "scheduled" && p.scheduled_at ? (
          <span className="text-violet-100">
            Scheduled for <span className="font-medium">{when(p.scheduled_at)}</span> on {handle} through the API · {usd(cost.total)}
            {p.scheduled_by ? <span className="text-white/45"> · by {p.scheduled_by}</span> : null}
          </span>
        ) : (
          <span className="text-rose-200">
            Didn&apos;t post{p.posted_count ? ` (${p.posted_count} of ${posts.length} posts are live; retrying finishes the thread)` : ""}.
          </span>
        )}
        <span className="flex-1" />
        {me.can_publish && (
          <>
            <button type="button" className={ghost} disabled={!!busy || !!why || !!apiWhy} onClick={() => setPicking((x) => !x)}>
              {p.state === "scheduled" ? "Change time" : "Reschedule"}
            </button>
            {postNow(true)}
            {!p.posted_count && handOffButton(false)}
            <button type="button" className={ghost} disabled={!!busy} onClick={() => call("Unscheduling…", undefined, "DELETE")}>
              {p.state === "failed" ? "Clear" : "Unschedule"}
            </button>
          </>
        )}
        {p.error && <div className="w-full text-xs text-rose-300">{p.error}</div>}
        {(why || apiWhy) && <div className="w-full text-xs text-amber-300">{p.state === "scheduled" ? `Heads up: it won't post until this is fixed. ${why ?? apiWhy}` : (why ?? apiWhy)}</div>}
        {err && <div className="w-full text-xs text-rose-300">{err}</div>}
        {picker}
        {handOff}
      </div>
    );

  // Not scheduled yet.
  if (!me.can_publish)
    return why || bundle.review_status !== "approved" ? null : (
      <div className={`${box} border-emerald-400/30 bg-emerald-400/[0.05]`}>
        <span className="text-emerald-200">Approved and ready. An admin can post or schedule it.</span>
      </div>
    );

  const costNote =
    method === "manual"
      ? "Posted by hand on X (free)."
      : apiWhy && acct
        ? `${apiWhy} Post it yourself (free).`
        : cost.withLink
          ? `Through X's API: ${price}, since ${cost.withLink === cost.posts ? "it has a link" : `${cost.withLink} ${cost.withLink === 1 ? "has" : "have"} a link`}. Posting it yourself is free.`
          : `Through X's API: ${price}.`;

  return (
    <div className={`${box} ${why ? "border-white/10 bg-white/[0.02]" : "border-emerald-400/30 bg-emerald-400/[0.05]"}`}>
      <div className="flex flex-col">
        <span className={why ? "text-white/50" : "text-emerald-200"}>{why ?? `Ready to go out on ${handle}.`}</span>
        {!why && <span className="text-[11px] text-white/45">{costNote}</span>}
      </div>
      <span className="flex-1" />
      {lead === "manual" ? (
        <>
          {handOffButton(true)}
          {method !== "manual" && account && (
            <>
              <button type="button" className={ghost} disabled={!!busy || !!why || !!apiWhy} onClick={() => setPicking((x) => !x)} title={apiWhy ?? "Pick a time; the board posts it through X's API"}>
                Schedule via API · {usd(cost.total)}
              </button>
              {postNow(false)}
            </>
          )}
        </>
      ) : (
        <>
          {handOffButton(false)}
          <button type="button" className={ghost} disabled={!!busy || !!why} onClick={() => setPicking((x) => !x)} title={why ?? "Pick a time; the board posts it through X's API"}>
            Schedule… · {usd(cost.total)}
          </button>
          {postNow(true)}
        </>
      )}
      {err && <div className="w-full text-xs text-rose-300">{err}</div>}
      {picker}
      {handOff}
    </div>
  );
}
