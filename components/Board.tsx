"use client";
// The whole board: sidebar (inbox, queue, folders, posted, settings) and the main view.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import brand from "@/brand.config";
import type { Bundle, Draft, ListItem, Me } from "@/lib/types";
import { FOLDERS, UNTITLED, folderOf, reviewMeta } from "@/lib/types";
import { compareBoard, planOrder } from "@/lib/order";
import XPost from "./XPost";
import Editor from "./Editor";
import ReviewView from "./ReviewView";
import PublishBar, { when } from "./PublishBar";
import Settings from "./Settings";

type Item = ListItem;
type View = { kind: "inbox" } | { kind: "queue" } | { kind: "posted" } | { kind: "settings" } | { kind: "folder"; folder: string } | { kind: "draft"; id: string };

const eyebrow = "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-white/40";
const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-[11px] font-medium transition ${on ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white/80"}`;
const ghost = "rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-white/65 transition hover:border-accent hover:text-accent disabled:opacity-40";
const navRow = (on: boolean) => `flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition ${on ? "bg-white/[0.07] text-white" : "text-white/80 hover:bg-white/[0.04]"}`;
const count = "rounded-full px-2 font-mono text-[11px]";

/** The draft's title in the header: click it and type. Enter or clicking away saves, Esc puts it back. */
function TitleField({ value, canEdit, onSave }: { value: string; canEdit: boolean; onSave: (title: string) => void }) {
  const [v, setV] = useState(value);
  const [editing, setEditing] = useState(false);
  const cancel = useRef(false);
  useEffect(() => {
    if (!editing) setV(value);
  }, [value, editing]);
  const text = "text-[15px] font-medium tracking-[-0.01em]";
  if (!canEdit) return <span className={`ml-2 min-w-0 truncate text-white/85 ${text}`}>{value}</span>;
  return (
    <span className="group/title relative ml-1 inline-grid min-w-[6ch] max-w-[min(640px,100%)] items-center">
      <span aria-hidden className={`invisible col-start-1 row-start-1 whitespace-pre px-1.5 pr-6 ${text}`}>{v || " "}</span>
      <input
        value={v}
        aria-label="Draft title"
        title="Click to rename"
        placeholder={UNTITLED}
        spellCheck
        onChange={(e) => setV(e.target.value)}
        onFocus={(e) => {
          setEditing(true);
          if (value === UNTITLED) e.currentTarget.select();
        }}
        onBlur={() => {
          setEditing(false);
          const t = v.trim();
          if (cancel.current || !t) {
            cancel.current = false;
            setV(value);
          } else if (t !== value) onSave(t);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancel.current = true;
            e.currentTarget.blur();
          }
        }}
        className={`col-start-1 row-start-1 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 pr-6 text-white outline-none transition placeholder:text-white/35 hover:border-white/15 hover:bg-white/[0.03] focus:border-accent focus:bg-white/[0.04] ${text}`}
      />
      <span aria-hidden className="pointer-events-none col-start-1 row-start-1 justify-self-end pr-1.5 text-[12px] text-white/30 opacity-0 transition group-hover/title:opacity-100 group-focus-within/title:opacity-0">
        ✎
      </span>
    </span>
  );
}

function readView(): View | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get("draft")) return { kind: "draft", id: q.get("draft")! };
  if (q.get("folder")) return { kind: "folder", folder: q.get("folder")! };
  if (q.get("queue")) return { kind: "queue" };
  if (q.get("posted")) return { kind: "posted" };
  if (q.get("settings")) return { kind: "settings" };
  if (q.get("inbox")) return { kind: "inbox" };
  return null;
}

function writeView(v: View) {
  const q = new URLSearchParams();
  if (v.kind === "draft") q.set("draft", v.id);
  else if (v.kind === "folder") q.set("folder", v.folder);
  else q.set(v.kind, "1");
  window.history.replaceState(null, "", `?${q.toString()}`);
}

// Folder lists filter on review status. "Needs review" also holds drafts marked Needs work (that's where their
// replies and suggested edits are); killed drafts only show under Killed.
type Filter = "in_review" | "approved" | "killed";
const FILTERS: [Filter, string][] = [
  ["in_review", "Needs review"],
  ["approved", "Approved"],
  ["killed", "Killed"],
];

const posted = (d: Item) => d.meta.publish.state === "posted";
const queued = (d: Item) => d.meta.publish.state === "scheduled" || d.meta.publish.state === "publishing" || d.meta.publish.state === "failed";
const searchHit = (d: Item, search: string) => {
  const s = search.trim().toLowerCase();
  return !s || d.title.toLowerCase().includes(s) || d.posts.some((p) => p.text.toLowerCase().includes(s));
};
const passes = (d: Item, f: Filter, search: string) => {
  if (posted(d)) return false;
  const st = d.meta.review_status;
  const ok = f === "in_review" ? st === "in_review" || st === "needs_work" : st === f;
  return ok && searchHit(d, search);
};

function Dot({ d }: { d: Item }) {
  const p = d.meta.publish.state;
  const cls = p === "posted" ? "bg-white/50" : p === "failed" ? "bg-rose-400" : p === "scheduled" ? "bg-violet-400" : { in_review: "bg-accent", approved: "bg-emerald-400", needs_work: "bg-amber-400", killed: "bg-rose-400/70" }[d.meta.review_status];
  return <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} />;
}

function Badges({ d }: { d: Item }) {
  const p = d.meta.publish;
  const m =
    p.state === "posted"
      ? { label: "Posted", badge: "bg-white/10 text-white/70" }
      : p.state === "publishing"
        ? { label: "Posting…", badge: "bg-violet-400/15 text-violet-300" }
        : p.state === "failed"
          ? { label: "Didn't post", badge: "bg-rose-400/15 text-rose-300" }
          : p.state === "scheduled" && p.method === "manual" && p.scheduled_at
            ? { label: `⏱ ${when(p.scheduled_at)} · in X`, badge: "bg-violet-400/15 text-violet-300" }
            : p.state === "scheduled" && brand.publishing.requireApproval && !d.meta.approved_current
            ? { label: "⚠ Needs approval to post", badge: "bg-amber-400/15 text-amber-300" }
            : p.state === "scheduled" && p.scheduled_at
              ? { label: `⏱ ${when(p.scheduled_at)}`, badge: "bg-violet-400/15 text-violet-300" }
            : reviewMeta(d.meta.review_status);
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {!!d.meta.pending_suggestions && <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-300">{d.meta.pending_suggestions} edit</span>}
      {!!d.meta.open_comments && <span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-[11px] text-amber-200">{d.meta.open_comments} 💬</span>}
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${m.badge}`}>{m.label}</span>
    </span>
  );
}

/** Copies the draft's share link: pasted in Slack (or Discord, iMessage) it unfurls with the copy and image. */
function CopyShare({ id, className = "" }: { id: string; className?: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const flash = (m: string | null, ms = 2000) => {
    setMsg(m);
    if (m) setTimeout(() => setMsg(null), ms);
  };
  const copy = async () => {
    setMsg("Copying…");
    const r = await fetch(`/api/drafts/${id}/share`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) return flash(j.error ?? "Couldn't make a link", 4000);
    try {
      await navigator.clipboard.writeText(j.url);
      flash("Copied ✓");
    } catch {
      window.prompt("Copy this link:", j.url);
      flash(null);
    }
  };
  return (
    <button type="button" className={`${ghost} ${className}`} onClick={copy} title="A link that shows the copy and image right in Slack when you paste it">
      {msg ?? "Copy share link"}
    </button>
  );
}

// Drag and drop (admins): drag a draft above or below another to reorder it, or onto another folder in the sidebar to
// move it there. Saved through /api/drafts/[id]/move. The drag carries its own type, not text, so dropping a draft on
// the editor never pastes anything.
const DRAG_TYPE = "application/x-draftboard-draft";
type DropSide = "before" | "after";
type Hint = { key: string; side: DropSide | "into"; axis: "x" | "y"; gap: number };
type DnD = {
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
};

/** Before or after the draft under the pointer: left/right in a multi-column grid, above/below in a list. */
function placeOf(e: DragEvent<HTMLElement>): Omit<Hint, "key"> {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const cs = el.parentElement ? getComputedStyle(el.parentElement) : null;
  const axis = cs && cs.display === "grid" && cs.gridTemplateColumns.trim().split(/\s+/).length > 1 ? "x" : "y";
  const side = axis === "x" ? (e.clientX < r.left + r.width / 2 ? "before" : "after") : e.clientY < r.top + r.height / 2 ? "before" : "after";
  const gap = (cs && parseFloat(axis === "x" ? cs.columnGap : cs.rowGap)) || 0;
  return { side, axis, gap };
}

/** The line between drafts where the dragged one will land. */
function DropLine({ hint }: { hint?: Hint | null }) {
  if (!hint || hint.side === "into") return null;
  const off = -(hint.gap / 2) - 1;
  const style: CSSProperties =
    hint.axis === "y" ? { left: 0, right: 0, height: 2, [hint.side === "before" ? "top" : "bottom"]: off } : { top: 0, bottom: 0, width: 2, [hint.side === "before" ? "left" : "right"]: off };
  return <span aria-hidden className="pointer-events-none absolute z-10 rounded-full bg-accent" style={style} />;
}

/** A draft on a board. `full` shows every post's whole text; without it long posts get X's "Show more" cut. */
function Card({ d, onOpen, dnd, hint, dragging, full }: { d: Item; onOpen: () => void; dnd?: DnD; hint?: Hint | null; dragging?: boolean; full?: boolean }) {
  const dim = d.meta.review_status === "killed";
  return (
    <div {...dnd} className={`relative flex flex-col gap-2 ${dragging ? "opacity-40" : ""}`}>
      <DropLine hint={hint} />
      <button type="button" onClick={onOpen} className="group flex items-start justify-between gap-2 text-left">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-white/85 group-hover:text-accent">{d.title}</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-white/35">{[d.label, d.meta.created_by_name && `by ${d.meta.created_by_name}`].filter(Boolean).join(" · ")}</div>
        </div>
        <Badges d={d} />
      </button>
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()} className={`cursor-pointer text-left transition hover:opacity-90 ${dim ? "opacity-40" : ""}`}>
        <div className="pointer-events-none">
          <XPost draft={d} width="fill" mode={full ? "expanded" : "feed"} />
        </div>
      </div>
    </div>
  );
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

export default function Board() {
  const [me, setMe] = useState<Me | null>(null);
  const [drafts, setDrafts] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [filter, setFilter] = useState<Filter>("in_review");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(FOLDERS.map((f) => [f.key, true])));
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; folder: string } | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  /** the draft just made with "New draft" (its editor opens with the caret in post 1) */
  const [fresh, setFresh] = useState<string | null>(null);
  /** the writer (or an admin) picks Write (the editor) or Review (comments, verdicts) */
  const [pane, setPane] = useState<"write" | "review" | null>(() =>
    typeof window !== "undefined" && ["write", "review"].includes(new URLSearchParams(window.location.search).get("pane") ?? "") ? (new URLSearchParams(window.location.search).get("pane") as "write" | "review") : null,
  );

  const load = useCallback(async () => {
    const r = await fetch("/api/drafts", { cache: "no-store" }).catch(() => null);
    if (!r) return void setLoadErr("Can't reach the server. Retrying in a moment."); // offline, or a deploy in progress
    if (r.status === 401) return void (window.location.href = "/signin");
    if (r.ok) {
      setDrafts(await r.json());
      setLoadErr(null);
    } else setLoadErr((await r.json().catch(() => ({}))).error ?? `The server answered ${r.status}. Check its logs.`);
    setLoaded(true);
  }, []);

  useEffect(() => {
    fetch("/api/me").then(async (r) => {
      if (r.status === 401) return void (window.location.href = "/signin");
      setMe((await r.json()) as Me);
    });
  }, []);

  useEffect(() => {
    if (!me) return;
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [me, load]);

  const inbox = useMemo(() => drafts.filter((d) => d.meta.review_status === "in_review" && !posted(d)).sort((a, b) => b.created_at.localeCompare(a.created_at)), [drafts]);
  const queue = useMemo(
    () =>
      drafts
        .filter(queued)
        .sort((a, b) => Number(b.meta.publish.state === "failed") - Number(a.meta.publish.state === "failed") || (a.meta.publish.scheduled_at ?? "").localeCompare(b.meta.publish.scheduled_at ?? "")),
    [drafts],
  );
  const postedList = useMemo(() => drafts.filter((d) => posted(d) && searchHit(d, search)).sort((a, b) => (b.meta.publish.posted_at ?? "").localeCompare(a.meta.publish.posted_at ?? "")), [drafts, search]);

  useEffect(() => {
    if (!loaded || view || !me) return;
    const v = readView();
    setView(v && (v.kind !== "folder" || FOLDERS.some((f) => f.key === v.folder)) ? v : { kind: "inbox" });
  }, [loaded, view, me]);

  const loadBundle = useCallback(async (id: string) => {
    const r = await fetch(`/api/drafts/${id}`, { cache: "no-store" });
    setBundle(r.ok ? await r.json() : null);
  }, []);

  useEffect(() => {
    setBundle(null);
    if (view?.kind === "draft") loadBundle(view.id);
  }, [view, loadBundle]);

  const go = (v: View) => {
    setView(v);
    writeView(v);
    setFresh(null);
    setPane(null);
    window.scrollTo({ top: 0 });
  };

  // "New draft": a blank draft in that folder, opened in the editor. One left without writing anything is thrown away
  // when you leave it.
  const newDraft = async (folder: string = FOLDERS[0].key) => {
    setBusy("New draft…");
    const r = await fetch("/api/drafts", { method: "POST", body: JSON.stringify({ folder }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return alert(j.error ?? "Couldn't make a draft");
    setDrafts((ds) => [j as Item, ...ds]);
    go({ kind: "draft", id: j.id });
    setFresh(j.id);
  };
  const onDiscarded = (id: string) => setDrafts((ds) => ds.filter((x) => x.id !== id));
  const newHere = () => newDraft(view?.kind === "folder" ? view.folder : view?.kind === "draft" ? drafts.find((x) => x.id === view.id)?.folder : undefined);

  const visible = useMemo(() => drafts.filter((d) => passes(d, filter, search)), [drafts, filter, search]);
  const inFolder = (f: string) => visible.filter((d) => d.folder === f).sort(compareBoard);

  // ---- drag and drop (admins) ----
  const dnd = me?.role === "admin";
  const showHint = (h: Hint) => setHint((cur) => (cur && cur.key === h.key && cur.side === h.side && cur.axis === h.axis && cur.gap === h.gap ? cur : h));
  const endDrag = () => {
    setDrag(null);
    setHint(null);
  };

  const moveDraft = async (folder: string, anchor?: { id: string; side: DropSide }) => {
    const moving = drag && drafts.find((x) => x.id === drag.id);
    endDrag();
    if (!moving) return;
    const group = drafts.filter((x) => x.id !== moving.id && x.folder === folder).sort(compareBoard);
    const k = anchor ? group.findIndex((x) => x.id === anchor.id) : -1;
    const at = k < 0 ? group.length : anchor!.side === "before" ? k : k + 1;
    const list = [...group.slice(0, at), moving, ...group.slice(at)];
    if (folder === moving.folder && [...group, moving].sort(compareBoard).every((x, i) => x.id === list[i].id)) return; // dropped where it was
    const changes = planOrder(list, moving.id);
    setDrafts((ds) => ds.map((x) => (x.id === moving.id ? { ...x, folder, order: changes[x.id] ?? x.order } : x.id in changes ? { ...x, order: changes[x.id] } : x)));
    const r = await fetch(`/api/drafts/${moving.id}/move`, { method: "POST", body: JSON.stringify({ folder, ids: list.map((x) => x.id) }) });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error ?? "Couldn't move that draft.");
    load();
  };

  /** A draft in a list or grid: drag it, or drop another one before/after it. */
  const itemDnd = (d: Item): DnD =>
    !dnd
      ? {}
      : {
          draggable: true,
          onDragStart: (e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData(DRAG_TYPE, d.id);
            setDrag({ id: d.id, folder: d.folder });
          },
          onDragEnd: endDrag,
          onDragOver: (e) => {
            if (!drag) return;
            e.stopPropagation();
            if (drag.id === d.id) return setHint(null);
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            showHint({ key: `item:${d.id}`, ...placeOf(e) });
          },
          onDrop: (e) => {
            if (!drag) return;
            e.stopPropagation();
            if (drag.id === d.id) return endDrag();
            e.preventDefault();
            moveDraft(d.folder, { id: d.id, side: placeOf(e).side as DropSide });
          },
        };
  /** A folder row in the sidebar: drop to move the draft in, at the end. */
  const intoDnd = (key: string, folder: string): DnD =>
    !dnd
      ? {}
      : {
          onDragOver: (e) => {
            if (!drag || folder === drag.folder) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            showHint({ key, side: "into", axis: "y", gap: 0 });
          },
          onDrop: (e) => {
            if (!drag || folder === drag.folder) return;
            e.preventDefault();
            e.stopPropagation();
            moveDraft(folder);
          },
        };
  const cardDnd = (d: Item) => ({ dnd: itemDnd(d), hint: hint?.key === `item:${d.id}` ? hint : null, dragging: drag?.id === d.id });
  /** Inbox cards: drag one onto a sidebar folder to move it (the inbox itself stays newest first). */
  const dragOnly = (d: Item) => {
    const { draggable, onDragStart, onDragEnd } = itemDnd(d);
    return { dnd: { draggable, onDragStart, onDragEnd }, dragging: drag?.id === d.id };
  };

  const merge = (saved: Draft) => setDrafts((ds) => ds.map((d) => (d.id === saved.id ? { ...d, ...saved, meta: d.meta } : d)));

  /** Renamed in the header. Shows at once; the editor picks it up from the list. */
  const saveTitle = async (d: Item, title: string) => {
    const was = d.title;
    setDrafts((ds) => ds.map((x) => (x.id === d.id ? { ...x, title } : x)));
    const r = await fetch(`/api/drafts/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setDrafts((ds) => ds.map((x) => (x.id === d.id ? { ...x, title: was } : x)));
      return alert(j.error ?? "Couldn't rename it");
    }
    merge(j);
  };

  const refreshAll = () => {
    load();
    if (view?.kind === "draft") loadBundle(view.id);
  };

  const current = view?.kind === "draft" ? (drafts.find((d) => d.id === view.id) ?? null) : null;
  const writer = current?.meta.created_by ?? null;
  const canWrite = !!current && (me?.role === "admin" || writer === me?.email);
  const live = current?.meta.publish.state === "posted" ? "This draft is live on X, so its copy is locked." : current?.meta.publish.state === "publishing" ? "This draft is being posted right now." : null;
  const showPane = canWrite && !live ? (pane ?? (writer === me?.email && current?.meta.review_status !== "approved" ? "write" : "review")) : "review";
  const back: { view: View; label: string } | null = !current
    ? null
    : posted(current)
      ? { view: { kind: "posted" }, label: "Posted" }
      : queued(current)
        ? { view: { kind: "queue" }, label: "Queue" }
        : current.meta.review_status === "in_review"
          ? { view: { kind: "inbox" }, label: "Inbox" }
          : { view: { kind: "folder", folder: current.folder }, label: folderOf(current.folder).label };

  // Admins: delete a draft for good.
  const deleteCurrent = async (d: Item) => {
    if (!confirm(`Delete "${d.title}" for good?\n\nIt disappears with its comments, suggestions, verdicts and history. This can't be undone.`)) return;
    setBusy("Deleting…");
    const r = await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return alert(j.error ?? "Couldn't delete it");
    setDrafts((ds) => ds.filter((x) => x.id !== d.id));
    go(back?.view ?? { kind: "inbox" });
    load();
  };

  if (!me) return <div className="p-8 text-white/40">Loading…</div>;

  const failed = queue.filter((d) => d.meta.publish.state === "failed").length;
  const grid = "grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3";
  const empty = "rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-white/40";

  return (
    <div className="flex min-h-screen" onDragOver={() => drag && setHint(null)}>
      <aside className="scroll-thin sticky top-0 flex h-screen w-[300px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/10 px-4 py-5">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logo} alt="" className="h-8 w-8 rounded-full" />
          <div className="min-w-0">
            <div className="truncate text-lg font-medium leading-tight tracking-[-0.02em]">{brand.name}</div>
            <div className="truncate text-xs text-white/45">
              {inbox.length} waiting for review · {me.name}
              {me.role === "admin" ? " (admin)" : ""}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={!!busy}
          onClick={newHere}
          title="Write a draft in the folder you're looking at. It goes to review as you write it."
          className="-mt-1 flex items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/[0.08] px-3 py-2 text-sm font-medium text-accent transition hover:border-accent hover:bg-accent/15 disabled:opacity-40"
        >
          <span className="text-base leading-none">+</span> New draft
        </button>

        <input className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-accent" placeholder="Search titles and copy" value={search} onChange={(e) => setSearch(e.target.value)} />

        <div className="flex flex-col gap-0.5">
          <button type="button" onClick={() => go({ kind: "inbox" })} className={navRow(view?.kind === "inbox")}>
            <span>Inbox · needs review</span>
            <span className={`${count} bg-accent/15 text-accent`}>{inbox.length}</span>
          </button>
          <button type="button" onClick={() => go({ kind: "queue" })} className={navRow(view?.kind === "queue")}>
            <span>Queue · scheduled</span>
            <span className={`${count} ${failed ? "bg-rose-400/15 text-rose-300" : "bg-violet-400/15 text-violet-300"}`}>{failed ? `${failed} failed` : queue.length}</span>
          </button>
          <button type="button" onClick={() => go({ kind: "posted" })} className={navRow(view?.kind === "posted")}>
            <span>Posted</span>
            <span className={`${count} text-white/40`}>{postedList.length}</span>
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className={eyebrow}>Folders</span>
          </div>
          <div className="mb-1 flex flex-wrap gap-1">
            {FILTERS.map(([f, label]) => (
              <button key={f} type="button" className={chip(filter === f)} onClick={() => setFilter(f)}>
                {label}
              </button>
            ))}
          </div>
          {FOLDERS.map((f) => {
            const items = inFolder(f.key);
            const on = view?.kind === "folder" && view.folder === f.key;
            return (
              <div key={f.key} className="flex flex-col">
                <div {...intoDnd(`folder:${f.key}`, f.key)} className={`flex items-center rounded-lg transition ${hint?.key === `folder:${f.key}` ? "bg-accent/10 ring-1 ring-accent/60" : on ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}>
                  <button type="button" className="px-2 py-1.5 text-xs text-white/40 hover:text-white" onClick={() => setOpen((o) => ({ ...o, [f.key]: !o[f.key] }))}>
                    {open[f.key] ? "▾" : "▸"}
                  </button>
                  <button type="button" className="flex flex-1 items-center justify-between py-1.5 pr-2.5 text-left text-sm text-white/85" onClick={() => go({ kind: "folder", folder: f.key })}>
                    <span>{f.label}</span>
                    <span className="font-mono text-[11px] tabular-nums text-white/40">{items.length}</span>
                  </button>
                </div>
                {open[f.key] && items.length > 0 && (
                  <div className="ml-5 flex flex-col border-l border-white/10 pl-2">
                    {items.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        {...itemDnd(d)}
                        onClick={() => go({ kind: "draft", id: d.id })}
                        className={`relative flex items-start gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] leading-snug transition ${view?.kind === "draft" && view.id === d.id ? "bg-white/[0.07] text-white" : "text-white/65 hover:bg-white/[0.04] hover:text-white"} ${drag?.id === d.id ? "opacity-40" : ""}`}
                      >
                        <DropLine hint={hint?.key === `item:${d.id}` ? hint : null} />
                        <Dot d={d} />
                        <span className="min-w-0 flex-1">{d.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col gap-1 pt-2">
          <button type="button" onClick={() => go({ kind: "settings" })} className={navRow(view?.kind === "settings")}>
            <span>Settings</span>
          </button>
          <a href="/api/auth/signout" className="px-2.5 text-[11px] text-white/30 hover:text-white/60">
            Sign out
          </a>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-8 py-6">
        {!loaded && <div className="text-white/40">Loading…</div>}
        {loadErr && <div className="mb-5 rounded-xl border border-rose-400/30 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-200">Couldn&apos;t load the drafts: {loadErr}</div>}
        {busy && <div className="fixed bottom-4 right-4 z-10 rounded-full bg-primary px-4 py-2 text-sm text-on-primary shadow">{busy}</div>}

        {view?.kind === "settings" && <Settings me={me} />}

        {view?.kind === "inbox" && (
          <div className="flex flex-col gap-5">
            <div>
              <div className={eyebrow}>Inbox</div>
              <h1 className="text-2xl font-medium tracking-[-0.02em]">Needs review · {inbox.length}</h1>
              <div className="text-sm text-white/45">Approve, mark Needs work, or Kill. Select words to comment; use ✎ to suggest an edit.</div>
            </div>
            {loaded && inbox.length === 0 && (
              <div className={empty}>
                All caught up.{" "}
                <button type="button" className="text-accent hover:underline" onClick={() => newDraft()}>
                  Write a draft
                </button>
              </div>
            )}
            <div className={grid}>
              {inbox.map((d) => (
                <Card key={d.id} d={d} full onOpen={() => go({ kind: "draft", id: d.id })} {...dragOnly(d)} />
              ))}
            </div>
          </div>
        )}

        {view?.kind === "queue" && (
          <div className="flex flex-col gap-5">
            <div>
              <div className={eyebrow}>Queue</div>
              <h1 className="text-2xl font-medium tracking-[-0.02em]">Scheduled · {queue.length}</h1>
              <div className="text-sm text-white/45">Approved drafts waiting for their time, soonest first: the board posts the ones it scheduled; &quot;in X&quot; ones were scheduled on X by hand.</div>
            </div>
            {loaded && queue.length === 0 && <div className={empty}>Nothing scheduled. Approve a draft, then pick a time from its page.</div>}
            {[...new Set(queue.map((d) => (d.meta.publish.state === "failed" ? "failed" : fmtDay(d.meta.publish.scheduled_at ?? d.created_at))))].map((day) => (
              <div key={day} className="flex flex-col gap-3">
                <div className={`${eyebrow} ${day === "failed" ? "!text-rose-300" : ""}`}>{day === "failed" ? "Didn't post: needs a look" : day}</div>
                <div className={grid}>
                  {queue
                    .filter((d) => (d.meta.publish.state === "failed" ? "failed" : fmtDay(d.meta.publish.scheduled_at ?? d.created_at)) === day)
                    .map((d) => (
                      <Card key={d.id} d={d} full onOpen={() => go({ kind: "draft", id: d.id })} />
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {view?.kind === "posted" && (
          <div className="flex flex-col gap-5">
            <div>
              <div className={eyebrow}>Posted</div>
              <h1 className="text-2xl font-medium tracking-[-0.02em]">Live on X · {postedList.length}</h1>
              <div className="text-sm text-white/45">Newest first.</div>
            </div>
            {loaded && postedList.length === 0 && <div className={empty}>Nothing posted yet{search.trim() ? " that matches this search" : ""}.</div>}
            <div className={grid}>
              {postedList.map((d) => (
                <Card key={d.id} d={d} full onOpen={() => go({ kind: "draft", id: d.id })} />
              ))}
            </div>
          </div>
        )}

        {view?.kind === "folder" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className={eyebrow}>Folder · {FILTERS.find(([f]) => f === filter)?.[1]}</div>
                <h1 className="text-2xl font-medium tracking-[-0.02em]">{folderOf(view.folder).label}</h1>
                <div className="text-sm text-white/45">{folderOf(view.folder).blurb}</div>
              </div>
              <button type="button" className={`${ghost} ml-auto`} disabled={!!busy} onClick={() => newDraft(view.folder)}>
                + New draft
              </button>
            </div>
            <div className={grid}>
              {inFolder(view.folder).map((d) => (
                <Card key={d.id} d={d} full onOpen={() => go({ kind: "draft", id: d.id })} {...cardDnd(d)} />
              ))}
            </div>
            {loaded && inFolder(view.folder).length === 0 && <div className="text-sm text-white/40">No drafts here with this filter.</div>}
          </div>
        )}

        {view?.kind === "draft" && !current && loaded && <div className="text-white/40">Draft not found. It may have been deleted.</div>}

        {current && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button type="button" className="text-white/45 hover:text-accent" onClick={() => back && go(back.view)}>
                ← {back?.label}
              </button>
              <TitleField key={current.id} value={current.title} canEdit={canWrite} onSave={(t) => saveTitle(current, t)} />
              {current.meta.created_by_name && <span className="text-xs text-white/40">by {current.meta.created_by_name}</span>}
              {canWrite && !live && (
                <div className="ml-2 flex items-center gap-1 rounded-full border border-white/10 p-1">
                  {(["write", "review"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setPane(p);
                        if (p === "review") loadBundle(current.id);
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${showPane === p ? "bg-white/[0.12] text-white" : "text-white/50 hover:text-white"}`}
                      title={p === "write" ? "Write it: the full editor, with media, @tags, quotes and video posts" : "Comments, suggested edits and the verdict"}
                    >
                      {p === "write" ? "Write" : `Review${current.meta.open_comments || current.meta.pending_suggestions ? ` · ${current.meta.open_comments + current.meta.pending_suggestions}` : ""}`}
                    </button>
                  ))}
                </div>
              )}
              <CopyShare id={current.id} className="ml-auto" />
              {current.meta.review_status === "in_review" && (
                <button
                  type="button"
                  className={ghost}
                  onClick={() => {
                    const next = inbox.find((d) => d.id !== current.id);
                    go(next ? { kind: "draft", id: next.id } : { kind: "inbox" });
                  }}
                >
                  Next in inbox →
                </button>
              )}
              {me.role === "admin" && (
                <button type="button" className={`${ghost} hover:!border-rose-400/60 hover:!text-rose-300`} disabled={!!busy} onClick={() => deleteCurrent(current)} title="Delete this draft for good">
                  {busy === "Deleting…" ? busy : "Delete"}
                </button>
              )}
            </div>

            {bundle && bundle.draft.id === current.id && <PublishBar bundle={bundle} me={me} onChanged={refreshAll} onBundle={setBundle} />}

            {showPane === "write" && <Editor draft={current} onSaved={(d) => (merge(d), loadBundle(d.id))} autoFocus={fresh === current.id} onDiscarded={onDiscarded} canDiscard={writer === me.email} locked={live} />}

            {showPane === "review" && bundle && bundle.draft.id === current.id && <ReviewView bundle={bundle} me={me} locked={live} onChanged={refreshAll} />}
          </div>
        )}
      </main>
    </div>
  );
}
