"use client";
// The draft editor. The X preview *is* the editor: click into a post and type. It autosaves as you go.
// Folder and label sit in a slim sidebar next to it; the title is in the board's header above.
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { upload as blobUpload } from "@vercel/blob/client";
import type { Draft, Media, XUser } from "@/lib/types";
import { FOLDERS, LABELS, isBlankDraft } from "@/lib/types";
import { FOLD, cutRange, firstUrl, hrefFor, tokenize, tweetLinkIn, xLength } from "@/lib/xtext";
import { MentionMenu, TaggedList, isMissing, rememberProfile, useMentionSuggest, useProfiles } from "./Mentions";
import { mediaUrl, posterUrl } from "@/lib/media";
import XPost, { AuthorAvatar, AuthorLine, LinkCard, QuoteCard, VideoPostCard, X, useTweet, xFont } from "./XPost";
import Lightbox from "./Lightbox";
import { getConfig } from "./config";

const field = "w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white outline-none transition focus:border-accent";
const eyebrow = "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-white/40";
const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-[11px] font-medium transition ${on ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white/80"}`;

const AUTOSAVE_MS = 1000;
const SAVED_KEYS: (keyof Draft)[] = ["title", "folder", "label", "posts"];
const isMedia = (f: File) => /^(image|video)\//.test(f.type);

/** A JPG of a video's opening frame, made in the browser: the poster before it plays, and the picture a share link
 *  shows in Slack. Null if the browser can't decode it. */
async function videoPoster(file: File): Promise<Blob | null> {
  const src = URL.createObjectURL(file);
  try {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = src;
    await new Promise<void>((ok, fail) => {
      v.onloadeddata = () => ok();
      v.onerror = () => fail(new Error("can't decode"));
      setTimeout(() => fail(new Error("timeout")), 15000);
    });
    v.currentTime = Math.min(0.4, (v.duration || 1) / 2);
    await new Promise<void>((ok) => {
      v.onseeked = () => ok();
      setTimeout(ok, 5000);
    });
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    if (!c.width || !c.height) return null;
    c.getContext("2d")!.drawImage(v, 0, 0);
    return await new Promise((ok) => c.toBlob((b) => ok(b), "image/jpeg", 0.85));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** Saves one file: straight from the browser to Vercel Blob (with a token from /api/upload), or, in local development
 *  without Blob, through /api/upload to .data/uploads. Returns its public URL. */
async function put(rel: string, file: Blob, onProgress?: (pct: number) => void): Promise<string> {
  if ((await getConfig()).storage === "local") {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("path", rel);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const j = (await r.json()) as { url?: string; error?: string };
    if (!r.ok || !j.url) throw new Error(j.error ?? r.statusText);
    return j.url;
  }
  const blob = await blobUpload(rel, file, {
    access: "public",
    handleUploadUrl: "/api/upload",
    contentType: file.type || undefined,
    multipart: file.size > 8 * 1024 * 1024,
    onUploadProgress: onProgress ? (e) => onProgress(Math.round(e.percentage)) : undefined,
  });
  return blob.url;
}

async function uploadMedia(file: File, onProgress: (pct: number) => void): Promise<Media> {
  if (file.type.startsWith("image/") && file.type !== "image/gif" && file.size > 5 * 1024 * 1024) throw new Error("X takes images up to 5 MB. Make this one smaller first.");
  if (file.type === "image/gif" && file.size > 15 * 1024 * 1024) throw new Error("X takes GIFs up to 15 MB.");
  const day = new Date().toLocaleDateString("en-CA");
  const ext = (/\.[A-Za-z0-9]+$/.exec(file.name)?.[0] ?? (file.type === "image/png" ? ".png" : "")).toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60) || "media";
  const rel = `uploads/${day}/${base}${ext}`;
  const url = await put(rel, file, onProgress);
  if (!file.type.startsWith("video/")) return { path: rel, type: "image", url };
  const still = await videoPoster(file);
  const poster = still ? await put(`uploads/${day}/${base}-poster.jpg`, still).catch(() => null) : null;
  return { path: rel, type: "video", url, ...(poster ? { poster_url: poster } : {}) };
}

const WAVY: React.CSSProperties = { textDecoration: "underline wavy #fb7185", textUnderlineOffset: 3, textDecorationThickness: 1 };

/** Post text with links/@mentions/#hashtags in X blue. Same characters as the source, so it lines up with the
 *  textarea on top. A tag that isn't an X account gets a red squiggle. `markAt` drops an empty marker span at
 *  that offset (where the @ being typed starts), so the mention menu can sit right under it. */
function Highlight({ text, markAt, missing }: { text: string; markAt?: number | null; missing?: (handle: string) => boolean }) {
  const out: React.ReactNode[] = [];
  const mark = <span key="mark" data-mark="" />;
  let pos = 0;
  for (const t of tokenize(text)) {
    const a = pos;
    const b = (pos += t.value.length);
    const style = t.kind === "text" ? undefined : { color: X.link, ...(t.kind === "mention" && missing?.(t.value.slice(1)) ? WAVY : null) };
    if (markAt != null && markAt >= a && markAt < b) {
      out.push(
        <span key={a} style={style}>
          {t.value.slice(0, markAt - a)}
        </span>,
        mark,
        <span key={`${a}+`} style={style}>
          {t.value.slice(markAt - a)}
        </span>,
      );
    } else
      out.push(
        <span key={a} style={style}>
          {t.value}
        </span>,
      );
  }
  if (markAt != null && markAt >= pos) out.push(mark);
  return <>{out}</>;
}

type Typing = { at: number; end: number; query: string };

/** The "@…" being typed at the caret: where the @ is, where the handle ends, and the part before the caret. */
function mentionAtCaret(el: HTMLTextAreaElement): Typing | null {
  const p = el.selectionStart;
  if (p !== el.selectionEnd) return null;
  const m = /(^|[^A-Za-z0-9_.])@([A-Za-z0-9_]{0,15})$/.exec(el.value.slice(0, p));
  if (!m) return null;
  const rest = /^[A-Za-z0-9_]*/.exec(el.value.slice(p))?.[0] ?? "";
  return { at: p - m[2].length - 1, end: p + rest.length, query: m[2] };
}

/** A textarea laid exactly over a rendered copy of its text. The copy shows the colors (links in blue)
 *  and sets the height; the transparent textarea on top takes the clicks, caret and selection.
 *  Typing @ opens a mention menu (↑↓, Enter/Tab, Esc); ⌘/Ctrl-click opens a link or @tag. */
const InlineText = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
    onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
    missing?: (handle: string) => boolean;
  }
>(function InlineText({ value, onChange, placeholder, onKeyDown, onPaste, missing }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState<Typing | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const caretTo = useRef<number | null>(null);
  const showing = open && typing ? typing : null;
  const { items, loading, notOnX } = useMentionSuggest(showing ? showing.query : null);

  // Keep the menu under the @ as the text reflows.
  useLayoutEffect(() => {
    if (!showing || !box.current) return setPos(null);
    const mk = box.current.querySelector("[data-mark]");
    if (!mk) return;
    const r = mk.getBoundingClientRect();
    const b = box.current.getBoundingClientRect();
    setPos({ top: r.bottom - b.top + 6, left: Math.max(-8, Math.min(r.left - b.left - 12, b.width - 292)) });
  }, [showing?.at, value]); // eslint-disable-line react-hooks/exhaustive-deps

  // After picking a handle, put the caret after the inserted "@handle ".
  useLayoutEffect(() => {
    if (caretTo.current === null || !inner.current) return;
    inner.current.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = null;
  }, [value]);

  useEffect(() => setActive((a) => Math.min(a, Math.max(0, items.length - 1))), [items.length]);

  const pick = (u: XUser) => {
    if (!typing) return;
    const after = value.slice(typing.end);
    const next = `${value.slice(0, typing.at)}@${u.username}${/^\s/.test(after) ? "" : " "}${after}`;
    caretTo.current = typing.at + u.username.length + 2;
    rememberProfile(u);
    setOpen(false);
    setTyping(null);
    onChange(next);
  };

  const keyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showing) {
      if (items.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
        return;
      }
      if (items.length && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        pick(items[Math.min(active, items.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }
    }
    onKeyDown?.(e);
  };

  // ⌘/Ctrl-click a link or @tag to open it (a plain click just places the caret, as usual).
  const click = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const i = e.currentTarget.selectionStart;
    let p = 0;
    for (const t of tokenize(value)) {
      const a = p;
      p += t.value.length;
      if (t.kind !== "text" && i >= a && i <= p) {
        window.open(hrefFor(t), "_blank", "noopener,noreferrer");
        return;
      }
    }
  };

  return (
    <div ref={box} className="relative">
      <div aria-hidden className="pointer-events-none whitespace-pre-wrap break-words" style={{ color: X.text }}>
        <Highlight text={value} markAt={showing?.at} missing={missing} />
        {"​"}
      </div>
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        rows={1}
        spellCheck
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          const t = mentionAtCaret(e.target);
          setTyping(t);
          setOpen(!!t);
          setActive(0);
        }}
        onSelect={(e) => {
          // caret moved (arrows, click): follow it, close when it leaves the @handle
          const t = mentionAtCaret(e.currentTarget);
          setTyping(t);
          if (!t) setOpen(false);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={keyDown}
        onClick={click}
        onPaste={onPaste}
        aria-autocomplete="list"
        aria-expanded={!!showing}
        className="absolute inset-0 h-full w-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent outline-none placeholder:text-[#71767B] selection:bg-[#1D9BF0]/35"
        style={{ color: "transparent", caretColor: X.text }}
      />
      {showing && pos && (
        <MentionMenu items={items} active={active} loading={loading} notOnX={notOnX} query={showing.query} pos={pos} onPick={pick} onHover={setActive} />
      )}
    </div>
  );
});

/** A post's media, X-style, with remove (×) and alt text (ALT) on each tile. */
function EditMedia({ media, onRemove, onAlt, onView }: { media: Media[]; onRemove: (k: number) => void; onAlt: (k: number, alt: string) => void; onView: (k: number) => void }) {
  const [altFor, setAltFor] = useState<number | null>(null);
  const single = media.length === 1;
  const fit = single ? "max-h-[440px] w-full object-contain" : "aspect-square w-full object-cover";
  return (
    <div className="mt-3">
      <div className={`overflow-hidden rounded-2xl border ${single ? "" : "grid grid-cols-2 gap-0.5"}`} style={{ borderColor: X.border }}>
        {media.map((m, k) => (
          <div key={`${m.path}-${k}`} className="group/m relative bg-black">
            <button type="button" onClick={() => onView(k)} title="View larger" className="block w-full cursor-zoom-in">
              {m.type === "video" ? (
                <>
                  <video src={`${mediaUrl(m)}#t=0.05`} poster={posterUrl(m)} preload="metadata" muted playsInline className={fit} />
                  <span className="absolute inset-0 m-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-sm text-white">▶</span>
                </>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(m)} alt={m.alt ?? ""} className={fit} />
              )}
            </button>
            <button type="button" onClick={() => onRemove(k)} title="Remove" className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-sm text-white/85 opacity-0 transition hover:text-white group-hover/m:opacity-100">
              ×
            </button>
            <button
              type="button"
              onClick={() => setAltFor(altFor === k ? null : k)}
              title={m.alt ? `Alt: ${m.alt}` : "Add alt text"}
              className={`absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white transition ${m.alt ? "" : "opacity-0 group-hover/m:opacity-100"}`}
            >
              {m.alt ? "ALT" : "+ ALT"}
            </button>
          </div>
        ))}
      </div>
      {altFor !== null && media[altFor] && (
        <input
          autoFocus
          value={media[altFor].alt ?? ""}
          onChange={(e) => onAlt(altFor, e.target.value)}
          onBlur={() => setAltFor(null)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && setAltFor(null)}
          placeholder={`Alt text for ${media.length > 1 ? `item ${altFor + 1}` : "this"} (what's in it, for screen readers)`}
          className="mt-2 w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-[#1D9BF0]"
          style={{ borderColor: X.border, color: X.text }}
        />
      )}
    </div>
  );
}

/** Shows the link-preview card for the first URL, after typing pauses (so it doesn't fetch on every key). */
function DebouncedLinkCard({ text }: { text: string }) {
  const url = firstUrl(text);
  const [settled, setSettled] = useState(url);
  useEffect(() => {
    const t = setTimeout(() => setSettled(url), 700);
    return () => clearTimeout(t);
  }, [url]);
  return settled ? <LinkCard url={settled} /> : null;
}

// The small pill that sits on a quote card's top edge.
const pill = "absolute right-3 top-0 z-10 flex items-center overflow-hidden rounded-full border bg-[#16181C] text-[13px] shadow-lg shadow-black/50";
const seg = "flex items-center gap-1.5 px-3 py-1 transition hover:bg-white/[0.06]";

function QuoteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="currentColor" aria-hidden>
      <path d="M6.5 6C4 6 2.5 8 2.5 10.5S4.2 15 6.3 15c.4 0 .7 0 1-.1-.5 1.4-1.7 2.5-3.3 3l.5 1.6C8 18.6 10.5 15.4 10.5 11V10.5C10.5 8 9 6 6.5 6zm11 0C15 6 13.5 8 13.5 10.5S15.2 15 17.3 15c.4 0 .7 0 1-.1-.5 1.4-1.7 2.5-3.3 3l.5 1.6c3.5-.9 6-4.1 6-8.5v-.5C21.5 8 20 6 17.5 6z" />
    </svg>
  );
}

/** A link to a post on X sitting in the text: show the post the way X would quote it, with "Convert to quote"
 *  to take the link out of the text and attach the post instead. Waits for typing to pause. */
function PendingQuote({ text, onConvert, onVideo }: { text: string; onConvert: (url: string) => void; onVideo: (url: string) => void }) {
  const url = tweetLinkIn(text)?.url ?? null;
  const [settled, setSettled] = useState(url);
  useEffect(() => {
    const t = setTimeout(() => setSettled(url), 500);
    return () => clearTimeout(t);
  }, [url]);
  const t = useTweet(settled);
  if (!settled) return null;
  const ok = t && !("error" in t);
  // keep the author's real handle (a pasted x.com/i/web/status/… link has none)
  const canonical = ok ? `https://x.com/${t.author.username}/status/${t.id}` : settled;
  return (
    <div className="relative pt-1">
      <QuoteCard url={settled} />
      {ok && (
        <div className={pill} style={{ borderColor: X.border, color: X.text }}>
          <button type="button" className={`${seg} hover:text-[#1D9BF0]`} onClick={() => onConvert(canonical)} title="Take the link out of the text and attach the post as a quote, the way X shows it">
            <QuoteIcon /> Convert to quote
          </button>
          {t.media?.some((m) => m.type === "video") && (
            <>
              <span className="h-4 w-px" style={{ background: X.border }} />
              <button type="button" className={`${seg} hover:text-[#1D9BF0]`} onClick={() => onVideo(canonical)} title="Attach just the video, with the author credited and linked to this post (X's Post video)">
                ▶ Post video
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A converted quote. Hover for "Back to link" (puts the link back at the end of the text) or "Remove". */
function EditQuote({ url, onBackToLink, onRemove }: { url: string; onBackToLink: () => void; onRemove: () => void }) {
  return (
    <div className="group/q relative pt-1">
      <QuoteCard url={url} />
      <div className={`${pill} opacity-0 transition focus-within:opacity-100 group-hover/q:opacity-100`} style={{ borderColor: X.border, color: X.text }}>
        <button type="button" className={`${seg} hover:text-[#1D9BF0]`} onClick={onBackToLink} title="Put the link back at the end of the text">
          Back to link
        </button>
        <span className="h-4 w-px" style={{ background: X.border }} />
        <button type="button" className={`${seg} hover:text-rose-300`} onClick={onRemove} title="Drop the quote">
          Remove
        </button>
      </div>
    </div>
  );
}

/** A video post: the video with the original author credited in its corner. Hover for "Back to link" / "Remove". */
function EditVideoPost({ url, onBackToLink, onRemove }: { url: string; onBackToLink: () => void; onRemove: () => void }) {
  return (
    <div className="group/q relative pt-1">
      <VideoPostCard url={url} />
      <div className={`${pill} opacity-0 transition focus-within:opacity-100 group-hover/q:opacity-100`} style={{ borderColor: X.border, color: X.text }}>
        <button type="button" className={`${seg} hover:text-[#1D9BF0]`} onClick={onBackToLink} title="Put the link back at the end of the text">
          Back to link
        </button>
        <span className="h-4 w-px" style={{ background: X.border }} />
        <button type="button" className={`${seg} hover:text-rose-300`} onClick={onRemove} title="Drop the video">
          Remove
        </button>
      </div>
    </div>
  );
}

export default function Editor({
  draft,
  onSaved,
  autoFocus = false,
  onDiscarded,
  canDiscard = true,
  locked = null,
}: {
  draft: Draft;
  onSaved: (d: Draft) => void;
  /** just made with "New draft": put the caret in post 1 */
  autoFocus?: boolean;
  /** an empty draft was thrown away on leaving it */
  onDiscarded?: (id: string) => void;
  /** the person who started it: an empty draft they leave is thrown away, and admins hear about it once it has words */
  canDiscard?: boolean;
  /** why the copy can't change right now (it's live on X, or being posted); null = editable */
  locked?: string | null;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [viewing, setViewing] = useState<{ media: Media[]; index: number } | null>(null);
  const [view, setView] = useState<"edit" | "feed">("edit");
  const [width, setWidth] = useState<"phone" | "desktop">("desktop");
  const [focusPost, setFocusPost] = useState<{ i: number; at: "start" | "end" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTo = useRef(0);
  const texts = useRef<(HTMLTextAreaElement | null)[]>([]);

  // Autosave bookkeeping. `latest` is the draft as edited (kept in sync synchronously, so a save never
  // misses the last keystroke); `base` is what the server last confirmed; `ver`/`savedVer` count edits.
  const latest = useRef<Draft>(draft);
  const base = useRef<Draft>(draft);
  const ver = useRef(0);
  const savedVer = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onDiscardedRef = useRef(onDiscarded);
  onDiscardedRef.current = onDiscarded;
  const canDiscardRef = useRef(canDiscard);
  canDiscardRef.current = canDiscard;
  /** An empty draft we just left, waiting a tick to be thrown away (see the draft.id effect). */
  const leaving = useRef<{ id: string; t: ReturnType<typeof setTimeout> } | null>(null);

  /** Only the fields that changed since the last save, so other fields (e.g. one a loop just wrote) aren't overwritten. */
  const changes = (from: Draft, to: Draft) => {
    const out: Record<string, unknown> = {};
    for (const k of SAVED_KEYS) if (JSON.stringify(from[k] ?? null) !== JSON.stringify(to[k] ?? null)) out[k] = to[k] ?? null;
    return out;
  };

  const doSave = async (snapshot: boolean): Promise<boolean> => {
    const cur = latest.current;
    const body = changes(base.current, cur);
    const sentVer = ver.current;
    if (!Object.keys(body).length) {
      savedVer.current = sentVer;
      setDirty(false);
      return true;
    }
    setSaving(true);
    try {
      const r = await fetch(`/api/drafts/${cur.id}${snapshot ? "" : "?autosave=1"}`, { method: "PATCH", body: JSON.stringify(body) });
      const saved = (await r.json()) as Draft & { error?: string };
      if (!r.ok) throw new Error(saved.error ?? r.statusText);
      onSavedRef.current(saved);
      if (saved.id !== latest.current.id) return true; // moved on to another draft meanwhile
      base.current = saved;
      savedVer.current = sentVer;
      if (ver.current === sentVer) {
        latest.current = saved;
        setD(saved);
        setDirty(false);
      }
      setSaveErr(null);
      setSavedAt(saved.updated_at);
      return true;
    } catch (e) {
      setSaveErr((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  /** Save now. Saves run one at a time, each sending whatever changed since the one before. */
  const flush = (snapshot = false): Promise<boolean> => {
    const run = chain.current.then(() => doSave(snapshot));
    chain.current = run.catch(() => {});
    return run;
  };
  /** Fire-and-forget save that survives the page closing or the editor going away. */
  const flushNow = () => {
    const body = changes(base.current, latest.current);
    if (!Object.keys(body).length) return;
    const id = latest.current.id;
    fetch(`/api/drafts/${id}?autosave=1`, { method: "PATCH", body: JSON.stringify(body), keepalive: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((saved) => saved && onSavedRef.current(saved))
      .catch(() => {});
    base.current = { ...base.current, ...(body as Partial<Draft>) };
  };

  /** The writer stepping away from their draft: the first time it has words in it, admins get one Slack DM (the server
   *  waits a moment so the save sent alongside lands first, and sends it once per draft). */
  const announce = (id: string) => fetch(`/api/drafts/${id}/announce`, { method: "POST", keepalive: true }).catch(() => {});
  const isWriter = () => canDiscardRef.current;

  /** Throw away an empty draft: first save what's pending (so the server sees it empty too), then delete.
   *  The server refuses if its copy has content, so this can never lose writing. */
  const discard = (id: string, body: Record<string, unknown>) =>
    chain.current
      .then(async () => {
        if (Object.keys(body).length) await fetch(`/api/drafts/${id}?autosave=1`, { method: "PATCH", body: JSON.stringify(body), keepalive: true });
        const r = await fetch(`/api/drafts/${id}?blank=1`, { method: "DELETE", keepalive: true });
        if (r.ok) onDiscardedRef.current?.(id);
      })
      .catch(() => {});

  useEffect(() => {
    // React's dev mode unmounts and remounts once on open: that's not leaving, so keep the draft.
    if (leaving.current?.id === draft.id) {
      clearTimeout(leaving.current.t);
      leaving.current = null;
    }
    latest.current = draft;
    base.current = draft;
    ver.current = savedVer.current = 0;
    setD(draft);
    setDirty(false);
    setSaveErr(null);
    setSavedAt(null);
    setMsg(null);
    // Leaving this draft (another draft, another view): save what's pending.
    // A draft that's still empty (a "New draft" nobody wrote in) is thrown away instead.
    return () => {
      const cur = latest.current;
      if (canDiscardRef.current && isBlankDraft(cur)) {
        const body = ver.current !== savedVer.current ? changes(base.current, cur) : {};
        leaving.current = { id: cur.id, t: setTimeout(() => discard(cur.id, body), 0) };
        return;
      }
      if (ver.current !== savedVer.current) flushNow();
      // deferred a tick like the discard, so React's dev-mode remount on open doesn't count as leaving
      if (isWriter()) leaving.current = { id: cur.id, t: setTimeout(() => announce(cur.id), 0) };
    };
  }, [draft.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A draft just made with "New draft": start typing straight away.
  useEffect(() => {
    if (autoFocus) setFocusPost({ i: 0, at: "end" });
  }, [draft.id, autoFocus]);

  // Dragged into another folder on the board while open here: show the new folder (without sending it back).
  useEffect(() => {
    if (draft.folder === base.current.folder) return;
    base.current = { ...base.current, folder: draft.folder };
    latest.current = { ...latest.current, folder: draft.folder };
    setD((p) => ({ ...p, folder: draft.folder }));
  }, [draft.folder]);

  // Renamed in the board's header (the title is edited there, not here): take it on without sending it back.
  useEffect(() => {
    if (draft.title === base.current.title) return;
    base.current = { ...base.current, title: draft.title };
    latest.current = { ...latest.current, title: draft.title };
    setD((p) => ({ ...p, title: draft.title }));
  }, [draft.title]);

  // Autosave about a second after typing stops.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => flush(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [d, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Put the caret in a post after adding or merging one.
  useEffect(() => {
    if (!focusPost) return;
    const el = texts.current[focusPost.i];
    if (el) {
      el.focus();
      const at = focusPost.at === "end" ? el.value.length : 0;
      el.setSelectionRange(at, at);
    }
    setFocusPost(null);
  }, [focusPost, d.posts.length]);

  const update = (fn: (prev: Draft) => Draft) => {
    if (locked) return setMsg({ kind: "err", text: locked });
    const next = fn(latest.current);
    latest.current = next;
    ver.current++;
    setD(next);
    setDirty(true);
  };
  const edit = (patch: Partial<Draft>) => update((prev) => ({ ...prev, ...patch }));
  const editPost = (i: number, fn: (p: Draft["posts"][number]) => Draft["posts"][number]) => update((prev) => ({ ...prev, posts: prev.posts.map((p, j) => (j === i ? fn(p) : p)) }));

  // ⌘S still works: saves immediately (and keeps a history snapshot).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        flush(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Closing or reloading the tab: send pending edits on the way out. (An empty draft stays put here, so a reload
  // lands back on it; it's thrown away when you next leave it inside the board.)
  useEffect(() => {
    const out = () => {
      if (ver.current !== savedVer.current) flushNow();
      if (isWriter() && !isBlankDraft(latest.current)) announce(latest.current.id);
    };
    window.addEventListener("beforeunload", out);
    return () => window.removeEventListener("beforeunload", out);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (file: File, i: number) => {
    uploadTo.current = i;
    setBusy("upload");
    setPct(null);
    try {
      if (locked) throw new Error(locked);
      const p = latest.current.posts[i];
      const has = p?.media ?? [];
      if (has.length >= 4) throw new Error("X allows up to 4 images per post.");
      if (has.length && (file.type.startsWith("video/") || file.type === "image/gif" || has.some((m) => m.type === "video" || /\.gif$/i.test(m.path))))
        throw new Error("X allows one video or GIF per post, on its own.");
      const m = await uploadMedia(file, setPct);
      editPost(i, (q) => ({ ...q, media: [...(q.media ?? []), m] }));
    } catch (e) {
      setMsg({ kind: "err", text: `Upload failed: ${(e as Error).message}` });
    } finally {
      setBusy(null);
      setPct(null);
    }
  };

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setMsg({ kind: "ok", text: `${label} copied` });
  };

  const addPost = () => {
    const i = d.posts.length;
    edit({ posts: [...d.posts, { text: "" }] });
    setFocusPost({ i, at: "start" });
  };
  const removePost = (i: number) => update((prev) => ({ ...prev, posts: prev.posts.filter((_, j) => j !== i) }));

  /** "Convert to quote": the post link leaves the text and is attached as the quoted post. */
  const toQuote = (i: number, url: string) =>
    editPost(i, (q) => {
      const l = tweetLinkIn(q.text);
      return { ...q, text: l ? cutRange(q.text, l.start, l.end) : q.text, quote: url };
    });
  /** "Post video": same, but only the post's video is attached, credited to its author. */
  const toVideoPost = (i: number, url: string) =>
    editPost(i, (q) => {
      const l = tweetLinkIn(q.text);
      return { ...q, text: l ? cutRange(q.text, l.start, l.end) : q.text, quote: null, video_post: url };
    });
  const unVideoPost = (i: number, keepLink: boolean) =>
    editPost(i, (q) => ({
      ...q,
      video_post: null,
      text: keepLink && q.video_post ? (q.text.trim() ? `${q.text.trimEnd()}\n\n${q.video_post}` : q.video_post) : q.text,
    }));
  /** Drop the quote; with `keepLink`, put its link back at the end of the text. */
  const unQuote = (i: number, keepLink: boolean) =>
    editPost(i, (q) => ({
      ...q,
      quote: null,
      text: keepLink && q.quote ? (q.text.trim() ? `${q.text.trimEnd()}\n\n${q.quote}` : q.quote) : q.text,
    }));

  // Backspace in an empty post (not the first) removes it and jumps to the end of the one above.
  const onPostKey = (i: number) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const p = d.posts[i];
    if (e.key === "Backspace" && i > 0 && p.text === "" && !p.media?.length) {
      e.preventDefault();
      removePost(i);
      setFocusPost({ i: i - 1, at: "end" });
    }
  };
  const onPostPaste = (i: number) => (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const f = Array.from(e.clipboardData.files).find(isMedia);
    if (f) {
      e.preventDefault();
      upload(f, i);
    }
  };

  const w = width === "phone" ? "w-[393px]" : "w-[598px]";
  const tagged = d.posts.flatMap((p) => tokenize(p.text).filter((t) => t.kind === "mention").map((t) => t.value.slice(1)));
  const profiles = useProfiles(tagged);
  const missing = (h: string) => isMissing(profiles.get(h.toLowerCase()));

  return (
    <div className="flex flex-col gap-6 min-[1120px]:flex-row min-[1120px]:items-start">
      {viewing && <Lightbox media={viewing.media} index={viewing.index} onClose={() => setViewing(null)} />}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/mp4,video/quicktime"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f, uploadTo.current);
          e.target.value = "";
        }}
      />

      {/* The post, editable in place */}
      <div className="flex min-w-0 flex-col items-start gap-3">
        <div className="flex items-center gap-1 rounded-full border border-white/10 p-1">
          <button type="button" className={chip(view === "edit")} onClick={() => setView("edit")}>
            Edit
          </button>
          <button type="button" className={chip(view === "feed")} onClick={() => setView("feed")} title="How it looks in the timeline, with Show more">
            Feed preview
          </button>
          <span className="mx-1 h-4 w-px bg-white/10" />
          {(["desktop", "phone"] as const).map((v) => (
            <button key={v} type="button" className={chip(width === v)} onClick={() => setWidth(v)}>
              {v === "phone" ? "Phone" : "Desktop"}
            </button>
          ))}
        </div>

        {view === "feed" ? (
          <div
            className="cursor-text"
            title="Click to edit"
            onClick={(e) => {
              const t = e.target as HTMLElement;
              if (t.closest("a,button,video")) return;
              // focus the post that was clicked
              const posts = Array.from(e.currentTarget.firstElementChild?.children ?? []);
              setView("edit");
              setFocusPost({ i: Math.max(0, posts.findIndex((p) => p.contains(t))), at: "end" });
            }}
          >
            <XPost key={`${d.id}-feed`} draft={d} mode="feed" width={width} />
          </div>
        ) : (
          <div className={`${w} max-w-full rounded-2xl border bg-black px-4 pb-3 pt-3 text-[15px] leading-5`} style={{ borderColor: X.border, fontFamily: xFont }}>
            {d.posts.map((p, i) => {
              const n = xLength(p.text);
              const long = n > FOLD;
              return (
                <div
                  key={i}
                  className="group/post flex gap-3"
                  onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
                  onDrop={(e) => {
                    const f = Array.from(e.dataTransfer.files).find(isMedia);
                    if (f) {
                      e.preventDefault();
                      upload(f, i);
                    }
                  }}
                >
                  <div className="flex flex-col items-center">
                    <AuthorAvatar />
                    <div className="mt-1 w-0.5 flex-1" style={{ background: X.border }} />
                  </div>
                  <div className="min-w-0 flex-1 pb-4">
                    <div className="flex min-w-0 items-center gap-1 leading-5">
                      <AuthorLine />
                    </div>
                    <InlineText
                      ref={(el) => {
                        texts.current[i] = el;
                      }}
                      value={p.text}
                      onChange={(text) => editPost(i, (q) => ({ ...q, text }))}
                      placeholder={i === 0 ? "What's happening?" : "Add another post"}
                      onKeyDown={onPostKey(i)}
                      onPaste={onPostPaste(i)}
                      missing={missing}
                    />
                    {!!p.media?.length && (
                      <EditMedia
                        media={p.media}
                        onView={(k) => setViewing({ media: p.media ?? [], index: k })}
                        onRemove={(k) => editPost(i, (q) => ({ ...q, media: (q.media ?? []).filter((_, n2) => n2 !== k) }))}
                        onAlt={(k, alt) => editPost(i, (q) => ({ ...q, media: (q.media ?? []).map((m, n2) => (n2 === k ? { ...m, alt } : m)) }))}
                      />
                    )}
                    {p.video_post ? (
                      <EditVideoPost url={p.video_post} onBackToLink={() => unVideoPost(i, true)} onRemove={() => unVideoPost(i, false)} />
                    ) : p.quote ? (
                      <EditQuote url={p.quote} onBackToLink={() => unQuote(i, true)} onRemove={() => unQuote(i, false)} />
                    ) : tweetLinkIn(p.text) ? (
                      <PendingQuote text={p.text} onConvert={(url) => toQuote(i, url)} onVideo={(url) => toVideoPost(i, url)} />
                    ) : (
                      !p.media?.length && <DebouncedLinkCard text={p.text} />
                    )}
                    <div className="mt-2 flex items-center gap-3 text-[12px] opacity-50 transition group-focus-within/post:opacity-100 group-hover/post:opacity-100" style={{ color: X.muted, fontFamily: "inherit" }}>
                      <button
                        type="button"
                        className="hover:text-[#1D9BF0]"
                        onClick={() => {
                          uploadTo.current = i;
                          fileRef.current?.click();
                        }}
                        title="Add an image or video (or paste / drop one onto the post)"
                      >
                        {busy === "upload" && uploadTo.current === i ? `Uploading${pct !== null && pct < 100 ? ` ${pct}%` : ""}…` : "+ Media"}
                      </button>
                      <button
                        type="button"
                        className="hover:text-[#1D9BF0]"
                        // with a quote, the link goes at the end: pasted into X, a trailing post link posts as a quote
                        onClick={() => { const ref = p.video_post ?? p.quote; copy(ref ? (p.text.trim() ? `${p.text.trimEnd()}\n\n${ref}` : ref) : p.text, `Post ${i + 1}`); }}
                      >
                        Copy
                      </button>
                      {d.posts.length > 1 && (
                        <button type="button" className="hover:text-rose-300" onClick={() => removePost(i)}>
                          Remove
                        </button>
                      )}
                      {tokenize(p.text).filter((t) => t.kind === "cashtag").length > 1 && (
                        <span className="ml-auto text-rose-300" title="X's API rejects posts with more than one $cashtag">
                          1 $cashtag max
                        </span>
                      )}
                      <span className={`ml-auto font-mono tabular-nums ${long ? "text-amber-300" : ""}`} title={long ? "Over 280 characters: only X Premium accounts can post this, and the feed cuts it with Show more" : undefined}>
                        {n}
                        {long ? " · needs X Premium" : ""}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            <button type="button" onClick={addPost} className="flex w-full items-center gap-3 text-left opacity-60 transition hover:opacity-100">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-lg" style={{ borderColor: X.border, color: X.muted }}>
                +
              </span>
              <span style={{ color: X.muted }}>Add a post to the thread</span>
            </button>
          </div>
        )}
        <div className="text-[11px] text-white/30">
          {view === "edit"
            ? "Click any text to edit; it saves as you type. Type @ to tag an account; ⌘-click a link or @tag to open it. Paste or drop an image onto a post to attach it. Paste a link to a post on X to quote it."
            : "Approximates X (dark mode). Click the post to edit."}
        </div>
      </div>

      {/* Slim sidebar: folder, label, save state, tagged accounts */}
      <aside className="scroll-thin flex w-full shrink-0 flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm min-[1120px]:sticky min-[1120px]:top-6 min-[1120px]:max-h-[calc(100vh-3rem)] min-[1120px]:w-[320px] min-[1120px]:overflow-y-auto 2xl:w-[340px]">
        <div className="flex flex-col gap-2">
          <div className={eyebrow}>{LABELS.length ? "Folder · label" : "Folder"}</div>
          <div className={`grid items-center gap-1.5 ${LABELS.length ? "grid-cols-2" : "grid-cols-1"}`}>
            <select className={field} value={d.folder} onChange={(e) => edit({ folder: e.target.value })} title="Folder">
              {FOLDERS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            {LABELS.length > 0 && (
              <select className={field} value={d.label ?? ""} onChange={(e) => edit({ label: e.target.value || undefined })} title="Label">
                <option value="">No label</option>
                {LABELS.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
          <div className="flex items-center gap-2 text-xs">
            {saveErr ? (
              <button type="button" className="text-rose-300 hover:underline" onClick={() => flush(true)} title={saveErr}>
                Couldn&apos;t save · retry
              </button>
            ) : dirty || saving ? (
              <span className="text-white/45">Saving…</span>
            ) : (
              <span className="text-white/45" title="Edits save automatically as you type">
                ✓ Saved{savedAt ? ` ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
              </span>
            )}
            {msg && <span className={msg.kind === "ok" ? "text-emerald-300" : "text-rose-300"}>{msg.text}</span>}
          </div>
          <div className="text-[11px] leading-snug text-white/35">Saves as you type. Teammates comment and suggest edits in Review, and approve it there.</div>
        </div>

        {tagged.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
            <div className={eyebrow}>Tagged on X</div>
            <TaggedList handles={tagged} />
          </div>
        )}

      </aside>
    </div>
  );
}
