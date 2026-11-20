"use client";
// Review: the post is shown the way X shows it, and that same surface is where you suggest edits (tracked changes),
// highlight phrases to comment, and give a verdict (approve / needs work / kill).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Bundle, Comment, Me, Suggestion, VersionRow, Verdict } from "@/lib/types";
import { reviewMeta } from "@/lib/types";
import { locate, makeAnchor } from "@/lib/anchor";
import { wordDiff } from "@/lib/diff";
import { hrefFor, tokenize, xLength } from "@/lib/xtext";
import { Actions, AuthorAvatar, AuthorLine, LinkCard, MediaBlock, QuoteCard, VideoPostCard, X, XLink, attachments, xFont } from "./XPost";
import { TagBox, TagText, usePeople } from "./TagBox";

const eyebrow = "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-white/40";
const ghost = "rounded-full border border-white/10 px-3 py-1 text-xs font-medium text-white/65 transition hover:border-accent hover:text-accent disabled:opacity-40";
const input = "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-accent scroll-thin";

export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** `full.slice(start, end)` with links, mentions and hashtags clickable. Tokenizing the whole text
 *  (not just the slice) keeps a URL whole when a comment highlight starts or ends inside it. */
function Colored({ full, start = 0, end }: { full: string; start?: number; end?: number }) {
  const stop = end ?? full.length;
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const t of tokenize(full)) {
    const a = pos;
    const b = (pos += t.value.length);
    if (b <= start || a >= stop) continue;
    const piece = full.slice(Math.max(a, start), Math.min(b, stop));
    out.push(
      t.kind === "text" ? (
        <span key={a}>{piece}</span>
      ) : (
        <XLink key={a} href={hrefFor(t)}>
          {piece}
        </XLink>
      ),
    );
  }
  return <>{out}</>;
}

/** Offsets in the post's current text for a DOM selection, skipping text that is only in a suggestion. */
function selectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!container.contains(r.startContainer) || !container.contains(r.endContainer)) return null;
  let pos = 0;
  let start = -1;
  let end = -1;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const skip = !!(n.parentElement && n.parentElement.closest("[data-noanchor]"));
    const len = n.textContent?.length ?? 0;
    if (n === r.startContainer) start = pos + (skip ? 0 : r.startOffset);
    if (n === r.endContainer) end = pos + (skip ? 0 : r.endOffset);
    if (!skip) pos += len;
  }
  return start >= 0 && end > start ? { start, end } : null;
}

type Range = { start: number; end: number; ids: string[] };
function segments(text: string, comments: Comment[]): Range[] {
  const spans = comments.map((c) => ({ c, at: locate(text, c) })).filter((x) => x.at) as { c: Comment; at: { start: number; end: number } }[];
  const cuts = new Set<number>([0, text.length]);
  for (const s of spans) cuts.add(s.at.start).add(s.at.end);
  const pts = [...cuts].sort((a, b) => a - b);
  const out: Range[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    if (a === b) continue;
    out.push({ start: a, end: b, ids: spans.filter((s) => s.at.start <= a && s.at.end >= b).map((s) => s.c.id) });
  }
  return out;
}

function PostText({
  text,
  comments,
  suggestion,
  active,
  onPick,
  onSelect,
}: {
  text: string;
  comments: Comment[];
  suggestion: Suggestion | null;
  active: string | null;
  onPick: (id: string) => void;
  onSelect: (start: number, end: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onMouseUp = () => {
    if (!ref.current) return;
    const o = selectionOffsets(ref.current);
    if (o) onSelect(o.start, o.end);
  };
  return (
    <div ref={ref} onMouseUp={onMouseUp} className="whitespace-pre-wrap break-words text-[15px] leading-[21px]" style={{ color: X.text }}>
      {suggestion
        ? wordDiff(text, suggestion.proposed_text).map((p, i) =>
            p.kind === "same" ? (
              <Colored key={i} full={p.text} />
            ) : p.kind === "del" ? (
              <span key={i} className="rounded-sm bg-rose-500/15 text-rose-300 line-through decoration-rose-300/80">
                {p.text}
              </span>
            ) : (
              <span key={i} data-noanchor className="rounded-sm bg-emerald-500/20 text-emerald-200">
                <Colored full={p.text} />
              </span>
            ),
          )
        : segments(text, comments).map((s, i) => {
            if (!s.ids.length) return <Colored key={i} full={text} start={s.start} end={s.end} />;
            const on = active !== null && s.ids.includes(active);
            return (
              <mark
                key={i}
                onClick={() => onPick(s.ids[0])}
                className={`cursor-pointer rounded-sm text-inherit ${on ? "bg-amber-300/45" : "bg-amber-300/20 hover:bg-amber-300/35"}`}
                style={{ color: "inherit", borderBottom: "2px solid rgba(252,211,77,.7)" }}
              >
                <Colored full={text} start={s.start} end={s.end} />
              </mark>
            );
          })}
    </div>
  );
}

function Thread({
  root,
  replies,
  me,
  readOnly,
  active,
  onFocus,
  onChanged,
}: {
  root: Comment;
  replies: Comment[];
  me: Me;
  readOnly: boolean;
  active: boolean;
  onFocus: () => void;
  onChanged: () => void;
}) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const people = usePeople();
  const post = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    await fetch(url, { method, body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    onChanged();
  };
  const where =
    root.target === "media" ? `On the media in post ${(root.post_index ?? 0) + 1}` : root.target === "draft" ? "On the whole draft" : null;
  return (
    <div onClick={onFocus} className={`rounded-xl border p-3 text-[13px] transition ${active ? "border-amber-300/60 bg-amber-300/[0.06]" : "border-white/10 bg-white/[0.03]"} ${root.resolved ? "opacity-60" : ""}`}>
      {where ? (
        <div className="mb-1 text-[11px] text-white/40">{where}</div>
      ) : (
        root.quote && <div className="mb-1 line-clamp-2 border-l-2 border-amber-300/60 pl-2 text-[12px] italic text-white/50">{root.quote}</div>
      )}
      {[root, ...replies].map((c) => (
        <div key={c.id} className="mt-1.5">
          <span className="font-medium text-white/90">{c.author_name}</span>
          <span className="ml-1.5 text-[11px] text-white/35">{ago(c.created_at)}</span>
          <div className="whitespace-pre-wrap text-white/80">
            <TagText body={c.body} people={people} />
          </div>
        </div>
      ))}
      {root.resolved && <div className="mt-1 text-[11px] text-emerald-300/80">Resolved by {root.resolved_by}</div>}
      {!readOnly && (
        <div className="mt-2 flex flex-col gap-1.5">
          {!root.resolved && (
            <TagBox me={me} className={`${input} min-h-[36px] text-[13px]`} rows={1} placeholder="Reply (type @ to tag)" value={reply} onChange={setReply} />
          )}
          <div className="flex flex-wrap gap-1.5">
            {!root.resolved && reply.trim() && (
              <button
                type="button"
                className={ghost}
                disabled={busy}
                onClick={async () => {
                  await post(`/api/drafts/${root.draft_id}/comments`, "POST", { parent_id: root.id, body: reply, target: root.target, post_index: root.post_index });
                  setReply("");
                }}
              >
                Reply
              </button>
            )}
            <button type="button" className={ghost} disabled={busy} onClick={() => post(`/api/comments/${root.id}`, "PATCH", { resolved: !root.resolved })}>
              {root.resolved ? "Reopen" : "Resolve"}
            </button>
            {(root.author_email === me.email || me.role === "admin") && (
              <button type="button" className={ghost} disabled={busy} onClick={() => confirm("Delete this thread?") && post(`/api/comments/${root.id}`, "DELETE")}>
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ s, me, editor, readOnly, current, showing, onShow, onChanged }: { s: Suggestion; me: Me; editor: boolean; readOnly: boolean; current: string; showing: boolean; onShow: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (action: string) => {
    setBusy(true);
    const r = await fetch(`/api/suggestions/${s.id}`, { method: "PATCH", body: JSON.stringify({ action }) });
    if (!r.ok) alert((await r.json()).error);
    setBusy(false);
    onChanged();
  };
  const stale = s.state === "pending" && s.base_text !== current;
  return (
    <div className={`rounded-xl border p-3 text-[13px] ${showing ? "border-emerald-400/50 bg-emerald-400/[0.05]" : "border-white/10 bg-white/[0.03]"}`}>
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-white/90">{s.author_name}</span>
        <span className="text-white/45">suggested an edit to post {s.post_index + 1}</span>
        <span className="ml-auto text-[11px] text-white/35">{ago(s.created_at)}</span>
      </div>
      {s.note && <div className="mt-1 text-white/75">{s.note}</div>}
      <div className="mt-2 max-h-28 overflow-hidden whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-[12px] leading-snug">
        {wordDiff(s.base_text, s.proposed_text)
          .filter((p) => p.kind !== "same" || p.text.length < 60)
          .map((p, i) => (
            <span key={i} className={p.kind === "del" ? "text-rose-300 line-through" : p.kind === "ins" ? "text-emerald-300" : "text-white/40"}>
              {p.kind === "same" && p.text.length > 30 ? ` … ` : p.text}
            </span>
          ))}
      </div>
      {stale && <div className="mt-1 text-[11px] text-amber-300/90">The post changed after this was suggested. Accepting replaces the whole post with this version.</div>}
      {s.state !== "pending" ? (
        <div className={`mt-2 text-[11px] ${s.state === "accepted" ? "text-emerald-300" : "text-white/40"}`}>
          {s.state === "accepted" ? "Accepted" : "Rejected"} by {s.decided_by}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={ghost} onClick={onShow}>
            {showing ? "Hide inline" : "Show inline"}
          </button>
          {!readOnly && editor && (
            <>
              <button type="button" className={`${ghost} border-emerald-400/40 text-emerald-300`} disabled={busy} onClick={() => act("accept")}>
                Accept
              </button>
              <button type="button" className={ghost} disabled={busy} onClick={() => act("reject")}>
                Reject
              </button>
            </>
          )}
          {!readOnly && s.author_email === me.email && (
            <button type="button" className={ghost} disabled={busy} onClick={() => act("withdraw")}>
              Withdraw
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function History({ id, editor, onRestored }: { id: string; editor: boolean; onRestored: () => void }) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [view, setView] = useState<number | null>(null);
  useEffect(() => {
    fetch(`/api/drafts/${id}/versions`).then(async (r) => setRows(r.ok ? await r.json() : []));
  }, [id]);
  if (!rows) return <div className="text-xs text-white/40">Loading history…</div>;
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((v) => (
        <div key={v.id} className="rounded-lg border border-white/10 p-2 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="text-white/80">{v.note ?? "Saved"}</span>
            <span className="text-white/40">· {v.author} · {ago(v.created_at)}</span>
            <button type="button" className="ml-auto text-accent hover:underline" onClick={() => setView(view === v.id ? null : v.id)}>
              {view === v.id ? "Hide" : "View"}
            </button>
            {editor && (
              <button
                type="button"
                className="text-white/50 hover:text-accent"
                onClick={async () => {
                  if (!confirm("Restore this version? The current text becomes a version in history.")) return;
                  await fetch(`/api/drafts/${id}/versions`, { method: "POST", body: JSON.stringify({ version_id: v.id }) });
                  onRestored();
                }}
              >
                Restore
              </button>
            )}
          </div>
          {view === v.id && (
            <div className="mt-2 whitespace-pre-wrap rounded bg-black/40 p-2 text-white/70">{v.data.posts.map((p, i) => `Post ${i + 1}:\n${p.text}`).join("\n\n")}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ReviewView({
  bundle,
  me,
  readOnly = false,
  locked = null,
  onChanged,
  banner,
}: {
  bundle: Bundle;
  me: Me;
  readOnly?: boolean;
  /** why the copy can't change (live on X / being posted): comments still work, edits and suggestions don't */
  locked?: string | null;
  onChanged: () => void;
  banner?: React.ReactNode;
}) {
  const { draft, comments, suggestions, verdicts } = bundle;
  // Edits directly, accepts suggestions, restores versions: admins and the draft's writer.
  const editor = me.role === "admin" || bundle.created_by === me.email;
  const [active, setActive] = useState<string | null>(null);
  const [pending, setPending] = useState<{ post: number; start: number; end: number; target: "text" | "media" | "draft" } | null>(null);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editNote, setEditNote] = useState("");
  const [direct, setDirect] = useState(false);
  const [shown, setShown] = useState<Record<number, string | null>>({});
  const [verdictOpen, setVerdictOpen] = useState<Verdict | null>(null);
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<"open" | "resolved" | "history">("open");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setActive(null);
    setPending(null);
    setEditing(null);
    setShown({});
    setTab("open");
  }, [draft.id]);

  const roots = comments.filter((c) => !c.parent_id);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);
  const openRoots = roots.filter((c) => !c.resolved);
  const pendingSugs = suggestions.filter((s) => s.state === "pending");
  const decidedSugs = suggestions.filter((s) => s.state !== "pending");
  const lastVerdict = verdicts[verdicts.length - 1];
  const status = bundle.review_status ?? "in_review";
  const canSuggest = !readOnly && !locked;

  // which suggestion is shown inline per post: explicit choice, else the newest pending one
  const inlineFor = (i: number): Suggestion | null => {
    if (i in shown) return pendingSugs.find((s) => s.id === shown[i]) ?? null;
    const list = pendingSugs.filter((s) => s.post_index === i);
    return list[list.length - 1] ?? null;
  };

  const submitComment = async () => {
    if (!pending || !body.trim()) return;
    setBusy(true);
    const text = draft.posts[pending.post]?.text ?? "";
    const a = pending.target === "text" ? makeAnchor(text, pending.start, pending.end) : null;
    await fetch(`/api/drafts/${draft.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ post_index: pending.target === "draft" ? null : pending.post, target: pending.target, body, ...(a ? { quote: a.quote, prefix: a.prefix, suffix: a.suffix, start_hint: a.start } : {}) }),
    });
    setBusy(false);
    setPending(null);
    setBody("");
    window.getSelection()?.removeAllRanges();
    onChanged();
  };

  const submitEdit = async () => {
    if (editing === null) return;
    setBusy(true);
    const base = draft.posts[editing].text;
    const r = direct
      ? await fetch(`/api/drafts/${draft.id}`, { method: "PATCH", body: JSON.stringify({ posts: draft.posts.map((p, i) => (i === editing ? { ...p, text: editText } : p)) }) })
      : await fetch(`/api/drafts/${draft.id}/suggestions`, { method: "POST", body: JSON.stringify({ post_index: editing, base_text: base, proposed_text: editText, note: editNote }) });
    setBusy(false);
    if (!r.ok) return alert((await r.json()).error);
    setEditing(null);
    setEditNote("");
    onChanged();
  };

  // Take a post's image out (e.g. a reviewer wants it simpler) so X shows the link's card instead.
  const removeMedia = async (i: number) => {
    const p = draft.posts[i];
    const media = p.media ?? [];
    const what = media.length > 1 ? `${media.length} images` : media[0]?.type === "video" ? "video" : "image";
    const after = attachments({ ...p, media: [] });
    const instead = after.quote
      ? " The quoted post will show in its place."
      : after.link
        ? ` X will show the link card for ${new URL(after.link).hostname.replace(/^www\./, "")} in its place.`
        : " This post has no link, so nothing will show in its place.";
    if (!confirm(`Remove the ${what} from post ${i + 1}?${instead}\n\nYou can bring it back from History.`)) return;
    setBusy(true);
    const r = await fetch(`/api/drafts/${draft.id}`, { method: "PATCH", body: JSON.stringify({ posts: draft.posts.map((q, j) => (j === i ? { ...q, media: [] } : q)) }) });
    setBusy(false);
    if (!r.ok) return alert((await r.json()).error);
    onChanged();
  };

  const giveVerdict = async () => {
    if (!verdictOpen) return;
    setBusy(true);
    await fetch(`/api/drafts/${draft.id}/verdict`, { method: "POST", body: JSON.stringify({ verdict: verdictOpen, reason }) });
    setBusy(false);
    setVerdictOpen(null);
    setReason("");
    onChanged();
  };

  const counts = useMemo(() => ({ open: openRoots.length + pendingSugs.length, resolved: roots.length - openRoots.length + decidedSugs.length }), [openRoots.length, pendingSugs.length, roots.length, decidedSugs.length]);

  return (
    <div className="flex flex-col gap-4">
      {banner}
      {/* verdict bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${reviewMeta(status).badge}`}>{reviewMeta(status).label}</span>
        {status === "approved" && !bundle.approved_current && <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">edited since</span>}
        {lastVerdict && (
          <span className="text-xs text-white/50">
            {lastVerdict.author_name}: {lastVerdict.verdict === "approve" ? "approved" : lastVerdict.verdict === "kill" ? "killed it" : "needs work"}
            {lastVerdict.reason ? ` · “${lastVerdict.reason}”` : ""} · {ago(lastVerdict.created_at)}
          </span>
        )}
        <span className="flex-1" />
        {!readOnly &&
          (["approve", "needs_work", "kill"] as Verdict[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVerdictOpen(verdictOpen === v ? null : v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                verdictOpen === v ? "border-accent text-accent" : v === "approve" ? "border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10" : v === "kill" ? "border-rose-400/40 text-rose-300 hover:bg-rose-400/10" : "border-amber-400/40 text-amber-300 hover:bg-amber-400/10"
              }`}
            >
              {v === "approve" ? "✓ Approve" : v === "kill" ? "✕ Kill" : "✎ Needs work"}
            </button>
          ))}
        {verdictOpen && (
          <div className="flex w-full items-center gap-2">
            <input className={input} autoFocus placeholder={verdictOpen === "approve" ? "Optional note" : "One line on why (optional)"} value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && giveVerdict()} />
            <button type="button" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:brightness-110 disabled:opacity-50" disabled={busy} onClick={giveVerdict}>
              Save
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,600px)_minmax(320px,1fr)]">
        {/* the post, as X shows it */}
        <div className="flex flex-col gap-2">
          <div className={`flex items-center gap-2 text-xs ${canSuggest ? "text-white" : "text-white/45"}`}>
            {canSuggest ? (
              <>
                <span>Select words to comment. Use</span>
                <span className="rounded border border-white/50 px-1.5 py-0.5 text-white">✎</span>
                <span>to {editor && direct ? "edit" : "suggest an edit"}.</span>
                {editor && (
                  <span className="ml-auto flex items-center gap-1 rounded-full border border-white/10 p-0.5">
                    {[false, true].map((d) => (
                      <button key={String(d)} type="button" onClick={() => setDirect(d)} className={`rounded-full px-2.5 py-0.5 ${direct === d ? "bg-white/[0.12] text-white" : "text-white/50"}`}>
                        {d ? "Edit" : "Suggest"}
                      </button>
                    ))}
                  </span>
                )}
              </>
            ) : (
              <span>{locked ?? ""}</span>
            )}
          </div>
          <div className="rounded-2xl border bg-black px-4 pb-3 pt-3" style={{ borderColor: X.border, fontFamily: xFont }}>
            {draft.posts.map((p, i) => {
              const last = i === draft.posts.length - 1;
              const sug = inlineFor(i);
              const postComments = openRoots.filter((c) => c.post_index === i && c.target === "text");
              const { quote, link, videoPost } = attachments(p);
              return (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <AuthorAvatar />
                    {!last && <div className="mt-1 w-0.5 flex-1" style={{ background: X.border }} />}
                  </div>
                  <div className={`group min-w-0 flex-1 ${last ? "" : "pb-4"}`}>
                    <div className="flex min-w-0 items-center gap-1 text-[15px] leading-5">
                      <AuthorLine />
                      <span className="ml-auto font-mono text-[10px] text-white/30">{xLength(p.text)}</span>
                      {canSuggest && editing !== i && (
                        <button
                          type="button"
                          title={editor && direct ? "Edit this post" : "Suggest an edit"}
                          onClick={() => {
                            setEditing(i);
                            setEditText(p.text);
                          }}
                          className="ml-1 rounded border border-white/50 px-1.5 text-[13px] text-white hover:border-accent hover:text-accent"
                        >
                          ✎
                        </button>
                      )}
                    </div>
                    {editing === i ? (
                      <div className="mt-1 flex flex-col gap-2">
                        <textarea
                          autoFocus
                          className="min-h-[140px] w-full resize-y rounded-lg border border-accent/60 bg-white/[0.04] p-2 text-[15px] leading-[21px] outline-none"
                          style={{ color: X.text, fontFamily: xFont }}
                          rows={Math.max(5, Math.ceil(editText.length / 55) + editText.split("\n").length)}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                        {!(editor && direct) && <input className={input} placeholder="Why? (optional)" value={editNote} onChange={(e) => setEditNote(e.target.value)} />}
                        <div className="flex gap-2">
                          <button type="button" className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-on-primary hover:brightness-110 disabled:opacity-50" disabled={busy || editText === p.text} onClick={submitEdit}>
                            {editor && direct ? "Save edit" : "Suggest this"}
                          </button>
                          <button type="button" className={ghost} onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                          <span className="ml-auto self-center font-mono text-[11px] text-white/40">{xLength(editText)} chars</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        {sug && (
                          <div className="mb-1 text-[11px] text-emerald-300/80">
                            Showing {sug.author_name}&apos;s suggested edit ·{" "}
                            <button type="button" className="underline" onClick={() => setShown((s) => ({ ...s, [i]: null }))}>
                              show original
                            </button>
                          </div>
                        )}
                        <PostText
                          text={p.text}
                          comments={postComments}
                          suggestion={sug}
                          active={active}
                          onPick={(id) => {
                            setActive(id);
                            setTab("open");
                          }}
                          onSelect={(start, end) => !readOnly && setPending({ post: i, start, end, target: "text" })}
                        />
                      </>
                    )}
                    {!!p.media?.length && (
                      <div className="relative">
                        <MediaBlock media={p.media} />
                        {!readOnly && (
                          // In Edit mode the editor's Remove button stays visible; otherwise both show on hover.
                          <div className={`absolute right-2 top-5 flex gap-1.5 transition ${canSuggest && editor && direct ? "" : "opacity-0 group-hover:opacity-100"}`}>
                            {canSuggest && editor && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => removeMedia(i)}
                                title="Take the media out of this post (a link in the post then shows as its card)"
                                className="rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white/80 transition hover:text-rose-300 disabled:opacity-50"
                              >
                                ✕ Remove {p.media.length > 1 ? "media" : p.media[0].type === "video" ? "video" : "image"}
                              </button>
                            )}
                            <button type="button" onClick={() => setPending({ post: i, start: 0, end: 0, target: "media" })} className="rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white/80 opacity-0 transition hover:text-white group-hover:opacity-100">
                              Comment on media
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {videoPost && <VideoPostCard url={videoPost} />}
                    {quote && <QuoteCard url={quote} />}
                    {link && <LinkCard url={link} />}
                    <Actions />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* rail */}
        <div className="flex flex-col gap-3">
          {pending && (
            <div className="rounded-xl border border-accent/50 bg-accent/[0.05] p-3">
              <div className="mb-1 text-[11px] text-white/45">
                {pending.target === "media" ? `Comment on the media in post ${pending.post + 1}` : pending.target === "draft" ? "Comment on the whole draft" : "Comment on"}
              </div>
              {pending.target === "text" && <div className="mb-2 border-l-2 border-accent/60 pl-2 text-[12px] italic text-white/65">{draft.posts[pending.post].text.slice(pending.start, pending.end)}</div>}
              <TagBox autoFocus me={me} className={`${input} min-h-[70px]`} placeholder="Your comment (type @ to tag)" value={body} onChange={setBody} onSubmit={submitComment} />
              <div className="mt-2 flex gap-2">
                <button type="button" className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-on-primary hover:brightness-110 disabled:opacity-50" disabled={busy || !body.trim()} onClick={submitComment}>
                  Comment
                </button>
                <button
                  type="button"
                  className={ghost}
                  onClick={() => {
                    setPending(null);
                    setBody("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-1 rounded-full border border-white/10 p-1 text-xs">
            {(
              [
                ["open", `Open · ${counts.open}`],
                ["resolved", `Done · ${counts.resolved}`],
                ["history", "History"],
              ] as [typeof tab, string][]
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`flex-1 rounded-full px-3 py-1 ${tab === k ? "bg-white/[0.12] text-white" : "text-white/50 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === "open" && (
            <>
              {pendingSugs.map((s) => (
                <SuggestionCard
                  key={s.id}
                  s={s}
                  me={me}
                  editor={editor}
                  readOnly={readOnly}
                  current={draft.posts[s.post_index]?.text ?? ""}
                  showing={inlineFor(s.post_index)?.id === s.id}
                  onShow={() => setShown((x) => ({ ...x, [s.post_index]: inlineFor(s.post_index)?.id === s.id ? null : s.id }))}
                  onChanged={onChanged}
                />
              ))}
              {openRoots.map((c) => (
                <Thread key={c.id} root={c} replies={repliesOf(c.id)} me={me} readOnly={readOnly} active={active === c.id} onFocus={() => setActive(c.id)} onChanged={onChanged} />
              ))}
              {roots.filter((c) => !c.resolved && c.target === "text" && c.post_index !== null && !locate(draft.posts[c.post_index]?.text ?? "", c)).length > 0 && (
                <div className="text-[11px] text-white/35">Some comments point at words that have since changed; they show without a highlight.</div>
              )}
              {!pendingSugs.length && !openRoots.length && <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-white/35">{readOnly ? "No feedback yet." : "No open comments. Select words in the post to start one."}</div>}
              {!readOnly && !pending && (
                <button type="button" className={`${ghost} self-start`} onClick={() => setPending({ post: 0, start: 0, end: 0, target: "draft" })}>
                  + Comment on the whole draft
                </button>
              )}
            </>
          )}
          {tab === "resolved" && (
            <>
              {decidedSugs.map((s) => (
                <SuggestionCard key={s.id} s={s} me={me} editor={editor} readOnly current={draft.posts[s.post_index]?.text ?? ""} showing={false} onShow={() => {}} onChanged={onChanged} />
              ))}
              {roots
                .filter((c) => c.resolved)
                .map((c) => (
                  <Thread key={c.id} root={c} replies={repliesOf(c.id)} me={me} readOnly={readOnly} active={false} onFocus={() => {}} onChanged={onChanged} />
                ))}
              {!counts.resolved && <div className="text-xs text-white/35">Nothing resolved yet.</div>}
            </>
          )}
          {tab === "history" && <History id={draft.id} editor={editor && !locked} onRestored={onChanged} />}
          {verdicts.length > 1 && (
            <details className="text-[12px] text-white/50">
              <summary className="cursor-pointer">All verdicts ({verdicts.length})</summary>
              {verdicts
                .slice()
                .reverse()
                .map((v) => (
                  <div key={v.id} className="mt-1">
                    {v.author_name}: {v.verdict.replace("_", " ")}
                    {v.reason ? ` · “${v.reason}”` : ""} · {ago(v.created_at)}
                  </div>
                ))}
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
