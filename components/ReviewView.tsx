"use client";
// Review: the post is shown the way X shows it, and that same surface is where you suggest edits (tracked changes),
// highlight phrases to comment, and give a verdict (approve / needs work / kill).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Bundle, Comment, Me, Suggestion, VersionRow, Verdict } from "@/lib/types";
import { reviewMeta } from "@/lib/types";
import { locate, makeAnchor } from "@/lib/anchor";
import { wordDiff } from "@/lib/diff";
import { type Change, applySuggestion, rebase } from "@/lib/rebase";
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

type Seg = { start: number; end: number; ids: string[] };
function segments(text: string, comments: Comment[]): Seg[] {
  const spans = comments.map((c) => ({ c, at: locate(text, c) })).filter((x) => x.at) as { c: Comment; at: { start: number; end: number } }[];
  const cuts = new Set<number>([0, text.length]);
  for (const s of spans) cuts.add(s.at.start).add(s.at.end);
  const pts = [...cuts].sort((a, b) => a - b);
  const out: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    if (a === b) continue;
    out.push({ start: a, end: b, ids: spans.filter((s) => s.at.start <= a && s.at.end >= b).map((s) => s.c.id) });
  }
  return out;
}

/** A suggested change placed in the post's current text (or the live preview of one being written). */
export type Placed = Change & { id: string; preview?: boolean };

const selecting = () => !!window.getSelection() && !window.getSelection()!.isCollapsed;

/** text.slice(a, b), with comment highlights. */
function CommentRuns({ text, segs, a, b, active, onPick }: { text: string; segs: Seg[]; a: number; b: number; active: string | null; onPick: (id: string) => void }) {
  return (
    <>
      {segs
        .filter((s) => s.end > a && s.start < b)
        .map((s) => {
          const st = Math.max(s.start, a);
          const en = Math.min(s.end, b);
          if (!s.ids.length) return <Colored key={st} full={text} start={st} end={en} />;
          const on = active !== null && s.ids.includes(active);
          return (
            <mark
              key={st}
              onClick={() => !selecting() && onPick(s.ids[0])}
              className={`cursor-pointer rounded-sm text-inherit ${on ? "bg-amber-300/45" : "bg-amber-300/20 hover:bg-amber-300/35"}`}
              style={{ color: "inherit", borderBottom: "2px solid rgba(252,211,77,.7)" }}
            >
              <Colored full={text} start={st} end={en} />
            </mark>
          );
        })}
    </>
  );
}

export type SelectAction = { label: string; primary?: boolean; run: (start: number, end: number) => void };

/**
 * One post's text. Suggested edits show inline as tracked changes (red strike = out, green = in), comments as
 * amber highlights. Highlighting words pops a small menu (Suggest edit / Comment, Google Docs style); clicking
 * a suggested change pops its card (accept / reject) right under it.
 */
function PostText({
  text,
  comments,
  changes,
  active,
  activeSug,
  onPick,
  onPickSug,
  actions,
  chip,
}: {
  text: string;
  comments: Comment[];
  changes: Placed[];
  active: string | null;
  activeSug: string | null;
  onPick: (id: string) => void;
  onPickSug: (id: string | null) => void;
  actions: SelectAction[];
  chip: React.ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<{ start: number; end: number; x: number; y: number } | null>(null);
  const [chipAt, setChipAt] = useState<{ x: number; y: number } | null>(null);

  const check = () => {
    if (!ref.current || !wrap.current || !actions.length) return;
    const o = selectionOffsets(ref.current);
    if (!o || !text.slice(o.start, o.end).trim()) return setTool(null);
    const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    const w = wrap.current.getBoundingClientRect();
    setTool({ ...o, x: Math.min(Math.max(r.left + r.width / 2 - w.left, 110), Math.max(110, w.width - 110)), y: r.top - w.top });
  };

  // the menu goes away when the highlight does
  useEffect(() => {
    if (!tool) return;
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !ref.current?.contains(sel.anchorNode)) setTool(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTool(null);
    document.addEventListener("selectionchange", onSel);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("selectionchange", onSel);
      document.removeEventListener("keydown", onKey);
    };
  }, [tool]);
  // the text changed under the highlight (a save, a refresh): its offsets are stale
  useEffect(() => setTool(null), [text]);

  // the open suggestion's card sits under the end of its change; any click elsewhere closes it
  const changeKey = changes.map((c) => `${c.id}:${c.start}:${c.end}:${c.insert.length}`).join("|");
  useLayoutEffect(() => {
    const el = activeSug && wrap.current?.querySelector(`[data-sug="${CSS.escape(activeSug)}"]`);
    if (!el || !wrap.current) return setChipAt(null);
    const rects = el.getClientRects();
    const last = rects[rects.length - 1] ?? el.getBoundingClientRect();
    const w = wrap.current.getBoundingClientRect();
    const next = { x: Math.round(Math.min(Math.max(last.left - w.left, 0), Math.max(0, w.width - 280))), y: Math.round(last.bottom - w.top + 6) };
    setChipAt((p) => (p && p.x === next.x && p.y === next.y ? p : next));
  }, [activeSug, text, changeKey]);
  useEffect(() => {
    if (!activeSug) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest("[data-sug],[data-sugchip],[data-sugcard]")) onPickSug(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [activeSug, onPickSug]);

  const segs = segments(text, comments);
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const ch of [...changes].sort((a, b) => a.start - b.start)) {
    if (ch.start > pos) out.push(<CommentRuns key={`t${pos}`} text={text} segs={segs} a={pos} b={ch.start} active={active} onPick={onPick} />);
    const on = activeSug === ch.id;
    out.push(
      <span
        key={`s${ch.id}`}
        data-sug={ch.preview ? undefined : ch.id}
        onClick={ch.preview ? undefined : () => !selecting() && onPickSug(on ? null : ch.id)}
        title={ch.preview ? undefined : "Suggested edit: click to accept or reject"}
        className={`rounded-sm ${ch.preview ? "border-b border-dashed border-accent/70" : "cursor-pointer hover:bg-emerald-400/10"} ${on ? "bg-emerald-400/15" : ""}`}
      >
        {wordDiff(text.slice(ch.start, ch.end), ch.insert).map((p, k) =>
          p.kind === "same" ? (
            <Colored key={k} full={p.text} />
          ) : p.kind === "del" ? (
            <span key={k} className="rounded-sm bg-rose-500/15 text-rose-300 line-through decoration-rose-300/80">
              {p.text}
            </span>
          ) : (
            <span key={k} data-noanchor className="rounded-sm bg-emerald-500/20 text-emerald-200">
              <Colored full={p.text} />
            </span>
          ),
        )}
      </span>,
    );
    pos = ch.end;
  }
  if (pos < text.length) out.push(<CommentRuns key={`t${pos}`} text={text} segs={segs} a={pos} b={text.length} active={active} onPick={onPick} />);

  return (
    <div ref={wrap} className="relative">
      <div
        ref={ref}
        onMouseUp={check}
        onKeyUp={check}
        onTouchEnd={() => setTimeout(check, 0)}
        className="whitespace-pre-wrap break-words text-[15px] leading-[21px]"
        style={{ color: X.text }}
      >
        {out}
      </div>
      {tool && (
        <div
          className="absolute z-30 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 whitespace-nowrap rounded-full border border-white/15 bg-[#16181C] p-1 shadow-lg shadow-black/60"
          style={{ left: tool.x, top: tool.y - 8 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => {
                a.run(tool.start, tool.end);
                setTool(null);
              }}
              className={a.primary ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-on-primary hover:brightness-110" : "rounded-full px-3 py-1 text-xs text-white/80 hover:bg-white/10 hover:text-white"}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {chipAt && chip && (
        <div data-sugchip className="absolute z-30" style={{ left: chipAt.x, top: chipAt.y }}>
          {chip}
        </div>
      )}
    </div>
  );
}

/** Where you type the replacement for highlighted words. */
function ReplaceBox({
  original,
  value,
  note,
  edit,
  busy,
  onChange,
  onNote,
  onSubmit,
  onCancel,
}: {
  original: string;
  value: string;
  note: string;
  edit: boolean;
  busy: boolean;
  onChange: (v: string) => void;
  onNote: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // the highlighted words start selected: type to replace them, or arrow in to tweak
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const keys = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (value !== original && !busy) onSubmit();
    }
    if (e.key === "Escape") onCancel();
  };
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-accent/50 bg-accent/[0.05] p-2.5">
      <div className="text-[12px] text-white/55">
        {edit ? "Replace" : "Suggest replacing"} <span className="text-rose-300/90 line-through decoration-rose-300/70">{original.length > 140 ? `${original.slice(0, 139)}…` : original}</span> with:
      </div>
      <textarea
        ref={ref}
        rows={Math.min(8, Math.max(2, Math.ceil(value.length / 60) + value.split("\n").length - 1))}
        className="w-full resize-y rounded-lg border border-white/15 bg-black/40 p-2 text-[15px] leading-[21px] outline-none transition focus:border-accent"
        style={{ color: X.text, fontFamily: xFont }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keys}
      />
      {!edit && <input className={input} placeholder="Why? (optional)" value={note} onChange={(e) => onNote(e.target.value)} onKeyDown={keys} />}
      <div className="flex items-center gap-2">
        <button type="button" className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-on-primary hover:brightness-110 disabled:opacity-50" disabled={busy || value === original} onClick={onSubmit}>
          {edit ? "Save edit" : "Suggest edit"}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          Cancel
        </button>
        <span className="ml-auto text-[11px] text-white/35">⌘↵ to {edit ? "save" : "suggest"} · Esc to cancel</span>
      </div>
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
  onEdit,
}: {
  root: Comment;
  replies: Comment[];
  me: Me;
  readOnly: boolean;
  active: boolean;
  onFocus: () => void;
  onChanged: () => void;
  /** open the replace box on the words this comment highlights (so a comment can become the edit) */
  onEdit?: { label: string; run: () => void };
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
            {!root.resolved && onEdit && (
              <button type="button" className={`${ghost} border-accent/40 text-accent`} onClick={onEdit.run}>
                {onEdit.label}
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

function SuggestionCard({
  s,
  me,
  editor,
  readOnly,
  stale,
  showing,
  busy,
  onShow,
  onDecide,
}: {
  s: Suggestion;
  me: Me;
  editor: boolean;
  readOnly: boolean;
  /** pending, and the words it changes are gone from the post */
  stale: boolean;
  showing: boolean;
  busy: boolean;
  onShow: () => void;
  onDecide: (action: "accept" | "reject" | "withdraw") => void;
}) {
  return (
    <div
      data-sugcard
      onClick={s.state === "pending" ? onShow : undefined}
      className={`rounded-xl border p-3 text-[13px] transition ${s.state === "pending" ? "cursor-pointer" : ""} ${showing ? "border-emerald-400/50 bg-emerald-400/[0.05]" : "border-white/10 bg-white/[0.03]"}`}
    >
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
      {stale && <div className="mt-1 text-[11px] text-amber-300/90">The words this changes are no longer in the post. Accepting replaces the whole post with this version.</div>}
      {s.state !== "pending" ? (
        <div className={`mt-2 text-[11px] ${s.state === "accepted" ? "text-emerald-300" : "text-white/40"}`}>
          {s.state === "accepted" ? "Accepted" : "Rejected"} by {s.decided_by}
        </div>
      ) : (
        !readOnly &&
        (editor || s.author_email === me.email) && (
          <div className="mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
            {editor && (
              <>
                <button type="button" className={`${ghost} border-emerald-400/40 text-emerald-300`} disabled={busy} onClick={() => onDecide("accept")}>
                  ✓ Accept
                </button>
                <button type="button" className={ghost} disabled={busy} onClick={() => onDecide("reject")}>
                  ✕ Reject
                </button>
              </>
            )}
            {s.author_email === me.email && (
              <button type="button" className={ghost} disabled={busy} onClick={() => onDecide("withdraw")}>
                Withdraw
              </button>
            )}
          </div>
        )
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
  const [hideSugs, setHideSugs] = useState<Record<number, boolean>>({});
  const [activeSug, setActiveSug] = useState<string | null>(null);
  // highlighted words being replaced (a suggestion, or a direct edit for whoever can edit)
  const [replacing, setReplacing] = useState<{ post: number; start: number; end: number; base: string; text: string; note: string; edit: boolean } | null>(null);
  const [verdictOpen, setVerdictOpen] = useState<Verdict | null>(null);
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<"open" | "resolved" | "history">("open");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setActive(null);
    setPending(null);
    setEditing(null);
    setHideSugs({});
    setActiveSug(null);
    setReplacing(null);
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
  // accepting or rejecting changes the copy, so it's off once the draft is live on X
  const canDecide = !readOnly && !locked;

  // where each pending suggestion lands in its post as it reads now (null = the words it changes are gone)
  const placement = useMemo(() => {
    const m = new Map<string, Change | null>();
    for (const s of suggestions) if (s.state === "pending") m.set(s.id, rebase(s.base_text, s.proposed_text, draft.posts[s.post_index]?.text ?? ""));
    return m;
  }, [suggestions, draft.posts]);

  /** What's drawn inline in post i: the replacement being typed, then the open suggestion, then newest first. Overlaps stay in the rail. */
  const changesFor = (i: number): Placed[] => {
    const text = draft.posts[i]?.text ?? "";
    const out: Placed[] = [];
    const fits = (c: Change) => !out.some((o) => c.start < o.end && o.start < c.end);
    if (replacing?.post === i && replacing.base === text && replacing.text !== text.slice(replacing.start, replacing.end))
      out.push({ id: "preview", start: replacing.start, end: replacing.end, insert: replacing.text, preview: true });
    if (!hideSugs[i]) {
      const list = pendingSugs.filter((s) => s.post_index === i).reverse();
      list.sort((x, y) => Number(y.id === activeSug) - Number(x.id === activeSug));
      for (const s of list) {
        const c = placement.get(s.id);
        if (c && fits(c)) out.push({ ...c, id: s.id });
      }
    }
    return out;
  };

  const pickSug = useCallback((id: string | null) => {
    setActiveSug(id);
    if (id) setTab("open");
  }, []);

  const decide = async (sid: string, action: "accept" | "reject" | "withdraw") => {
    setBusy(true);
    const r = await fetch(`/api/suggestions/${sid}`, { method: "PATCH", body: JSON.stringify({ action }) });
    setBusy(false);
    if (!r.ok) alert((await r.json()).error);
    setActiveSug(null);
    onChanged();
  };

  /** Open the replace box on post `post`'s words start..end (edges trimmed, so a triple-clicked paragraph keeps its line break). */
  const openReplace = (post: number, start: number, end: number, edit: boolean) => {
    const t = draft.posts[post]?.text ?? "";
    while (start < end && /\s/.test(t[start])) start++;
    while (end > start && /\s/.test(t[end - 1])) end--;
    // a drag that stops mid-word means the whole word
    const w = (c: string | undefined) => !!c && /[\p{L}\p{N}'’_$@#]/u.test(c);
    while (start > 0 && w(t[start - 1]) && w(t[start])) start--;
    while (end < t.length && w(t[end - 1]) && w(t[end])) end++;
    if (end <= start) return;
    setPending(null);
    setEditing(null);
    setActiveSug(null);
    setReplacing({ post, start, end, base: t, text: t.slice(start, end), note: "", edit });
  };

  const submitReplace = async () => {
    if (!replacing) return;
    const { post, start, end, base, text, note, edit } = replacing;
    const current = draft.posts[post]?.text ?? "";
    // if the post was saved meanwhile, land the change where those words are now
    const proposed = applySuggestion(base, base.slice(0, start) + text + base.slice(end), current);
    if (proposed === null) return alert("The post changed while you were typing and those words are gone. Highlight them again.");
    if (proposed === current) return;
    setBusy(true);
    const r = edit
      ? await fetch(`/api/drafts/${draft.id}`, { method: "PATCH", body: JSON.stringify({ posts: draft.posts.map((p, i) => (i === post ? { ...p, text: proposed } : p)) }) })
      : await fetch(`/api/drafts/${draft.id}/suggestions`, { method: "POST", body: JSON.stringify({ post_index: post, base_text: current, proposed_text: proposed, note: note.trim() || null }) });
    setBusy(false);
    if (!r.ok) return alert((await r.json()).error);
    setReplacing(null);
    window.getSelection()?.removeAllRanges();
    onChanged();
  };

  /** What highlighting words in post i offers. */
  const actionsFor = (i: number): SelectAction[] =>
    readOnly
      ? []
      : [
          ...(canSuggest ? [{ label: editor && direct ? "✎ Edit" : "✎ Suggest edit", primary: true, run: (a: number, b: number) => openReplace(i, a, b, editor && direct) }] : []),
          {
            label: "Comment",
            primary: !canSuggest,
            run: (a: number, b: number) => {
              setReplacing(null);
              setPending({ post: i, start: a, end: b, target: "text" });
            },
          },
        ];

  /** The card under an open suggestion in post i. */
  const chipFor = (i: number) => {
    const s = pendingSugs.find((x) => x.id === activeSug && x.post_index === i);
    if (!s) return null;
    const mine = s.author_email === me.email;
    return (
      <div className="w-[280px] rounded-xl border border-white/15 bg-[#16181C] p-2.5 text-[12px] shadow-xl shadow-black/60">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-white/90">{s.author_name}</span>
          <span className="text-white/45">suggested this</span>
          <span className="ml-auto text-[11px] text-white/35">{ago(s.created_at)}</span>
        </div>
        {s.note && <div className="mt-1 whitespace-pre-wrap text-white/75">{s.note}</div>}
        {canDecide && (editor || mine) && (
          <div className="mt-2 flex gap-1.5">
            {editor && (
              <>
                <button type="button" className="rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-medium text-black hover:bg-emerald-400 disabled:opacity-50" disabled={busy} onClick={() => decide(s.id, "accept")}>
                  ✓ Accept
                </button>
                <button type="button" className={ghost} disabled={busy} onClick={() => decide(s.id, "reject")}>
                  ✕ Reject
                </button>
              </>
            )}
            {mine && (
              <button type="button" className={ghost} disabled={busy} onClick={() => decide(s.id, "withdraw")}>
                Withdraw
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  /** On a comment about specific words: jump straight to replacing them (the editor edits, others suggest). */
  const editFromComment = (c: Comment) => {
    if (!canSuggest || c.target !== "text" || c.post_index === null) return undefined;
    const at = locate(draft.posts[c.post_index]?.text ?? "", c);
    if (!at) return undefined;
    const post = c.post_index;
    return { label: editor ? "✎ Edit this part" : "✎ Suggest an edit here", run: () => openReplace(post, at.start, at.end, editor) };
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
                <span>Highlight words to {editor && direct ? "edit them" : "suggest an edit"} or comment.</span>
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
              <span>{locked ? `${locked} Highlight words to comment.` : ""}</span>
            )}
          </div>
          <div className="rounded-2xl border bg-black px-4 pb-3 pt-3" style={{ borderColor: X.border, fontFamily: xFont }}>
            {draft.posts.map((p, i) => {
              const last = i === draft.posts.length - 1;
              const nSugs = pendingSugs.filter((s) => s.post_index === i && placement.get(s.id)).length;
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
                          title={editor && direct ? "Edit the whole post" : "Suggest a rewrite of the whole post (to change a few words, highlight them instead)"}
                          onClick={() => {
                            setReplacing(null);
                            setEditing(i);
                            setEditText(p.text);
                          }}
                          className="ml-1 rounded-full border border-white/25 px-2 py-0.5 text-[11px] text-white/70 hover:border-accent hover:text-accent"
                        >
                          {editor && direct ? "✎ Edit post" : "✎ Rewrite post"}
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
                        {nSugs > 0 && (
                          <div className="mb-1 text-[11px] text-emerald-300/80">
                            {hideSugs[i] ? (
                              <>
                                Showing the original ·{" "}
                                <button type="button" className="underline" onClick={() => setHideSugs((h) => ({ ...h, [i]: false }))}>
                                  show {nSugs === 1 ? "the suggested edit" : `${nSugs} suggested edits`}
                                </button>
                              </>
                            ) : (
                              <>
                                {nSugs === 1 ? "1 suggested edit" : `${nSugs} suggested edits`} in green{editor && !readOnly ? ", click to accept or reject" : ""} ·{" "}
                                <button
                                  type="button"
                                  className="underline"
                                  onClick={() => {
                                    setHideSugs((h) => ({ ...h, [i]: true }));
                                    setActiveSug(null);
                                  }}
                                >
                                  show original
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        <PostText
                          text={p.text}
                          comments={postComments}
                          changes={changesFor(i)}
                          active={active}
                          activeSug={activeSug}
                          onPick={(id) => {
                            setActive(id);
                            setTab("open");
                          }}
                          onPickSug={pickSug}
                          actions={actionsFor(i)}
                          chip={chipFor(i)}
                        />
                        {replacing?.post === i && (
                          <ReplaceBox
                            key={`${replacing.start}-${replacing.end}`}
                            original={replacing.base.slice(replacing.start, replacing.end)}
                            value={replacing.text}
                            note={replacing.note}
                            edit={replacing.edit}
                            busy={busy}
                            onChange={(text) => setReplacing((r) => r && { ...r, text })}
                            onNote={(note) => setReplacing((r) => r && { ...r, note })}
                            onSubmit={submitReplace}
                            onCancel={() => setReplacing(null)}
                          />
                        )}
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
                  readOnly={!canDecide}
                  stale={!placement.get(s.id)}
                  showing={activeSug === s.id}
                  busy={busy}
                  onShow={() => {
                    setHideSugs((h) => ({ ...h, [s.post_index]: false }));
                    pickSug(activeSug === s.id ? null : s.id);
                  }}
                  onDecide={(a) => decide(s.id, a)}
                />
              ))}
              {openRoots.map((c) => (
                <Thread key={c.id} root={c} replies={repliesOf(c.id)} me={me} readOnly={readOnly} active={active === c.id} onFocus={() => setActive(c.id)} onChanged={onChanged} onEdit={editFromComment(c)} />
              ))}
              {roots.filter((c) => !c.resolved && c.target === "text" && c.post_index !== null && !locate(draft.posts[c.post_index]?.text ?? "", c)).length > 0 && (
                <div className="text-[11px] text-white/35">Some comments point at words that have since changed; they show without a highlight.</div>
              )}
              {!pendingSugs.length && !openRoots.length && <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-white/35">{readOnly ? "No feedback yet." : "Nothing open. Highlight words in the post to suggest an edit or comment."}</div>}
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
                <SuggestionCard key={s.id} s={s} me={me} editor={editor} readOnly stale={false} showing={false} busy={false} onShow={() => {}} onDecide={() => {}} />
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
