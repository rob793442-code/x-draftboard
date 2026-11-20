"use client";
// Renders a draft the way X shows it (dark mode): avatar, name + check mark, thread line,
// "Show more" cut at 280 characters, media, and link-preview cards.
import { useEffect, useState, useSyncExternalStore } from "react";
import brand from "@/brand.config";
import type { Draft, Media, Post, Tweet, XAccount } from "@/lib/types";
import { mediaUrl, posterUrl } from "@/lib/media";
import { displayUrl, firstUrl, foldIndex, hrefFor, parseTweetUrl, tokenize, tweetLinkIn, xDate } from "@/lib/xtext";
import Lightbox from "./Lightbox";

export { mediaUrl, posterUrl };

export const X = { text: "#E7E9EA", muted: "#71767B", border: "#2F3336", link: "#1D9BF0" };
export const xFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** A link in post text. Opens the source in a new tab. `pointer-events-auto` keeps it clickable
 *  inside board cards (whose preview is otherwise click-through to open the draft); stopping the
 *  click keeps the card or a comment highlight underneath from reacting too. Not draggable, so a
 *  text selection for a comment can start on a link. */
export function XLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      className="pointer-events-auto hover:underline"
      style={{ color: X.link }}
    >
      {children}
    </a>
  );
}

const BADGE = {
  business: { fill: "#E2B719", check: "#14192C", label: "Verified organization" },
  government: { fill: "#829AAB", check: "#FFFFFF", label: "Verified government account" },
  blue: { fill: "#1D9BF0", check: "#FFFFFF", label: "Verified account" },
};

export function Badge({ kind = "blue" }: { kind?: keyof typeof BADGE }) {
  const b = BADGE[kind];
  return (
    <svg viewBox="0 0 22 22" className="h-[18px] w-[18px] shrink-0" aria-label={b.label}>
      <path
        fill={b.fill}
        d="M20.4 11c0-1.3-.8-2.4-2-3 .4-1.3.2-2.7-.8-3.6s-2.3-1.2-3.6-.8c-.6-1.2-1.7-2-3-2s-2.4.8-3 2c-1.3-.4-2.7-.2-3.6.8S3.2 6.7 3.6 8c-1.2.6-2 1.7-2 3s.8 2.4 2 3c-.4 1.3-.2 2.7.8 3.6s2.3 1.2 3.6.8c.6 1.2 1.7 2 3 2s2.4-.8 3-2c1.3.4 2.7.2 3.6-.8s1.2-2.3.8-3.6c1.2-.6 2-1.7 2-3z"
      />
      <path fill={b.check} d="M9.6 14.6 6.5 11.5l1.3-1.3 1.8 1.8 4.6-4.9 1.3 1.2z" />
    </svg>
  );
}

// ---------- who the posts are from: the connected X account, else the brand's placeholder ----------
type Author = { name: string; username: string; avatar?: string; verified: "blue" | "business" | "government" | null };
const FALLBACK: Author = { name: brand.x.name, username: brand.x.handle, avatar: brand.logo, verified: brand.x.verified };
let author: Author = FALLBACK;
let accountLoad: Promise<void> | null = null;
const authorListeners = new Set<() => void>();

/** Re-reads the connected account (after connecting or disconnecting it in Settings). */
export function reloadAccount() {
  accountLoad = fetch("/api/x/account")
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { account?: XAccount | null } | null) => {
      const a = j?.account;
      author = a ? { name: a.name, username: a.username, avatar: a.avatar ?? brand.logo, verified: a.verified_type ?? null } : FALLBACK;
      authorListeners.forEach((l) => l());
    })
    .catch(() => {});
  return accountLoad;
}

export function useAuthor(): Author {
  useEffect(() => {
    if (!accountLoad) reloadAccount();
  }, []);
  return useSyncExternalStore(
    (l) => {
      authorListeners.add(l);
      return () => authorListeners.delete(l);
    },
    () => author,
    () => FALLBACK,
  );
}

/** The avatar in a post's left column. */
export function AuthorAvatar() {
  const a = useAuthor();
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={a.avatar ?? brand.logo}
      alt=""
      onError={(e) => {
        if (!e.currentTarget.src.endsWith(brand.logo)) e.currentTarget.src = brand.logo;
      }}
      className="h-10 w-10 shrink-0 rounded-full bg-white/10 object-cover"
    />
  );
}

/** Name, check mark and @handle at the top of a post. */
export function AuthorLine() {
  const a = useAuthor();
  return (
    <>
      <span className="truncate font-bold" style={{ color: X.text }}>
        {a.name}
      </span>
      {a.verified && <Badge kind={a.verified} />}
      <span className="truncate" style={{ color: X.muted }}>
        @{a.username}
      </span>
    </>
  );
}

// One lookup per post on X per page, shared by every card that shows it.
const tweets = new Map<string, Promise<Tweet | { error: string }>>();

/** The quoted post, from /api/tweet (null while loading). */
export function useTweet(url: string | null): Tweet | { error: string } | null {
  const [t, setT] = useState<Tweet | { error: string } | null>(null);
  useEffect(() => {
    setT(null);
    const tw = url ? parseTweetUrl(url) : null;
    if (!tw) return;
    let on = true;
    if (!tweets.has(tw.id))
      tweets.set(
        tw.id,
        fetch(`/api/tweet?url=${encodeURIComponent(tw.url)}`)
          .then((r) => r.json())
          .catch(() => ({ error: "Couldn't load this post." })),
      );
    tweets.get(tw.id)!.then((x) => {
      if ("error" in x) tweets.delete(tw.id); // try again next time
      if (on) setT(x);
    });
    return () => {
      on = false;
    };
  }, [url]);
  return t;
}

/** The quoted post's text: links, @s, #s and $s in blue but not separate links (the whole card opens the post). */
function QuoteText({ text }: { text: string }) {
  const cut = foldIndex(text);
  const shown = cut === null ? text : text.slice(0, cut).trimEnd();
  return (
    <div className="whitespace-pre-wrap break-words px-3 pt-0.5 text-[15px] leading-5" style={{ color: X.text }}>
      {tokenize(shown).map((t, i) => (
        <span key={i} style={t.kind === "text" ? undefined : { color: X.link }}>
          {t.value /* links come already shortened by X (display_url) */}
        </span>
      ))}
      {cut !== null && (
        <>
          …<span className="block" style={{ color: X.link }}>Show more</span>
        </>
      )}
    </div>
  );
}

function QuoteMedia({ media }: { media: NonNullable<Tweet["media"]> }) {
  const play = (m: NonNullable<Tweet["media"]>[number]) =>
    m.type === "video" ? (
      <span className="absolute inset-0 m-auto flex h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-[#1D9BF0] text-sm text-white">▶</span>
    ) : m.type === "gif" ? (
      <span className="absolute bottom-2 left-2 rounded bg-black/75 px-1.5 text-[12px] font-bold text-white">GIF</span>
    ) : null;
  if (media.length === 1) {
    const m = media[0];
    const ratio = m.width && m.height ? Math.max(m.width / m.height, 0.75) : 16 / 9;
    return (
      <div className="relative mt-3 border-t" style={{ borderColor: X.border }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.url} alt="" className="max-h-[510px] w-full object-cover" style={{ aspectRatio: String(ratio) }} />
        {play(m)}
      </div>
    );
  }
  return (
    <div className="mt-3 grid grid-cols-2 gap-0.5 border-t" style={{ borderColor: X.border }}>
      {media.slice(0, 4).map((m, i) => (
        <div key={i} className={`relative ${media.length === 3 && i === 0 ? "row-span-2" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.url} alt="" className={`h-full w-full object-cover ${media.length === 3 && i === 0 ? "" : "aspect-[16/9]"}`} />
          {play(m)}
        </div>
      ))}
    </div>
  );
}

/** A quoted post, drawn the way X draws a quote inside a post (dark mode). The card opens the post on X. */
export function QuoteCard({ url }: { url: string }) {
  const t = useTweet(url);
  const box = "mt-3 block overflow-hidden rounded-2xl border";
  if (!t)
    return (
      <div className={`${box} animate-pulse px-3 py-3`} style={{ borderColor: X.border }}>
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-white/10" />
          <div className="h-3 w-40 rounded bg-white/10" />
        </div>
        <div className="mt-3 h-3 w-4/5 rounded bg-white/10" />
        <div className="mt-2 h-3 w-3/5 rounded bg-white/10" />
      </div>
    );
  const a = { href: url, target: "_blank", rel: "noopener noreferrer", title: url, onClick: (e: React.MouseEvent) => e.stopPropagation() };
  if ("error" in t)
    return (
      <a {...a} className={`${box} px-3 py-3 text-[15px] transition hover:bg-white/[0.03]`} style={{ borderColor: X.border, color: X.muted }}>
        {t.error}
        <div className="mt-0.5 truncate text-[13px]" style={{ color: X.link }}>
          {displayUrl(url)}
        </div>
      </a>
    );
  const art = t.article;
  return (
    <a {...a} className={`${box} transition hover:bg-white/[0.03]`} style={{ borderColor: X.border, fontFamily: xFont }}>
      <div className="flex min-w-0 items-center gap-1 px-3 pt-3 text-[15px] leading-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {t.author.avatar && <img src={t.author.avatar} alt="" className="mr-0.5 h-5 w-5 shrink-0 rounded-full" />}
        <span className="truncate font-bold" style={{ color: X.text }}>
          {t.author.name}
        </span>
        {t.author.verified && <Badge kind={t.author.verified} />}
        <span className="shrink-0 truncate" style={{ color: X.muted }}>
          @{t.author.username} · {xDate(t.created_at)}
        </span>
      </div>
      {t.text && <QuoteText text={t.text} />}
      {art ? (
        <div className="pb-3">
          {art.cover && (
            <div className="mx-3 mt-3 overflow-hidden rounded-2xl border" style={{ borderColor: X.border }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={art.cover} alt="" className="aspect-[5/2] w-full object-cover" />
            </div>
          )}
          <div className="px-3 pt-2 text-[17px] font-bold leading-6" style={{ color: X.text }}>
            {art.title}
          </div>
          {art.preview && (
            <div className="line-clamp-3 whitespace-pre-line px-3 pt-0.5 text-[15px] leading-5" style={{ color: X.muted }}>
              {art.preview}
            </div>
          )}
        </div>
      ) : t.media?.length ? (
        <QuoteMedia media={t.media} />
      ) : (
        <div className="pb-3" />
      )}
    </a>
  );
}

/** A video re-posted from another post on X ("Post video" in X's share menu): the video plays in the post, with the
 *  original author in its bottom-left corner linking to the post it came from. */
export function VideoPostCard({ url }: { url: string }) {
  const t = useTweet(url);
  const [open, setOpen] = useState(false);
  const a = { href: url, target: "_blank", rel: "noopener noreferrer", draggable: false, onClick: (e: React.MouseEvent) => e.stopPropagation() };
  if (!t) return <div className="mt-3 aspect-video animate-pulse rounded-2xl border bg-white/5" style={{ borderColor: X.border }} />;
  const v = "error" in t ? null : t.media?.find((m) => m.type === "video" || m.type === "gif");
  if ("error" in t || !v?.mp4)
    return (
      <a {...a} className="mt-3 block rounded-2xl border px-3 py-3 text-[15px]" style={{ borderColor: X.border, color: X.muted }}>
        {"error" in t ? t.error : "Couldn't find a video on this post."}
        <div className="mt-0.5 truncate text-[13px]" style={{ color: X.link }}>{displayUrl(url)}</div>
      </a>
    );
  const ratio = v.width && v.height ? v.width / v.height : 16 / 9;
  // X's video server refuses players on other sites, so the file comes through our own /api/xvideo.
  const src = `/api/xvideo?u=${encodeURIComponent(v.mp4)}`;
  return (
    <div className="relative mt-3 overflow-hidden rounded-2xl border bg-black" style={{ borderColor: X.border }}>
      <video src={src} poster={v.url} controls preload="metadata" playsInline className="max-h-[560px] w-full bg-black object-contain" style={{ aspectRatio: String(Math.min(Math.max(ratio, 0.6), 2)) }} />
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white/80 transition hover:text-white">
        ⤢ Expand
      </button>
      {/* X's attribution chip: author + check, opens the original post */}
      <a {...a} title={`Original post by @${t.author.username}`} className="pointer-events-auto absolute bottom-16 left-2 flex max-w-[75%] items-center gap-1.5 rounded-full bg-black/70 py-1 pl-1 pr-2.5 text-[13px] font-bold text-white transition hover:bg-black/90">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {t.author.avatar && <img src={t.author.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full" />}
        <span className="truncate">{t.author.name}</span>
        {t.author.verified && <Badge kind={t.author.verified} />}
      </a>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          <video src={src} poster={v.url} controls autoPlay playsInline className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke={X.muted} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function Actions() {
  return (
    <div className="mt-3 flex max-w-[425px] items-center justify-between pr-2">
      <Icon d="M4 12a8 7 0 1 1 3 5.5L3.5 19l1-3.6A6.7 6.7 0 0 1 4 12z" />
      <Icon d="M7 7h9a3 3 0 0 1 3 3v6M17 17H8a3 3 0 0 1-3-3V8M4 10l3-3 3 3M20 14l-3 3-3-3" />
      <Icon d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
      <Icon d="M5 20V12M10 20V6M15 20v-9M20 20V9" />
      <Icon d="M12 4v11M8 8l4-4 4 4M5 14v5h14v-5" />
    </div>
  );
}

function RichText({ text }: { text: string }) {
  return (
    <>
      {tokenize(text).map((t, i) =>
        t.kind === "text" ? (
          <span key={i}>{t.value}</span>
        ) : (
          <XLink key={i} href={hrefFor(t)}>
            {t.kind === "url" ? displayUrl(t.value) : t.value}
          </XLink>
        ),
      )}
    </>
  );
}

export function LinkCard({ url }: { url: string }) {
  const [card, setCard] = useState<{ domain: string; title?: string; image?: string } | null>(null);
  useEffect(() => {
    let on = true;
    fetch(`/api/og?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((c) => on && setCard(c))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [url]);
  if (!card) return null;
  // The whole card opens the source in a new tab (in board cards it stays click-through to the draft).
  const a = { href: url, target: "_blank", rel: "noopener noreferrer", title: url, onClick: (e: React.MouseEvent) => e.stopPropagation() };
  if (!card.image)
    return (
      <a {...a} className="mt-3 block rounded-2xl border px-3 py-2.5 text-[14px] transition hover:bg-white/[0.03]" style={{ borderColor: X.border, color: X.muted }}>
        {card.domain}
        {card.title && <div style={{ color: X.text }}>{card.title}</div>}
      </a>
    );
  return (
    <a {...a} className="group/card mt-3 block">
      <div className="relative overflow-hidden rounded-2xl border transition group-hover/card:brightness-110" style={{ borderColor: X.border }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.image} alt="" className="aspect-[1.91/1] w-full object-cover" />
        {card.title && (
          <div className="absolute bottom-2 left-2 right-2 truncate rounded px-1.5 py-0.5 text-[13px]" style={{ background: "rgba(0,0,0,.77)", color: "#fff" }}>
            {card.title}
          </div>
        )}
      </div>
      <div className="mt-1 text-[13px] group-hover/card:underline" style={{ color: X.muted }}>
        From {card.domain}
      </div>
    </a>
  );
}

/** A post's images/videos. Click one to see it full screen (click outside or Esc to come back).
 *  A single video keeps its inline controls and gets an Expand button instead. */
export function MediaBlock({ media }: { media: Media[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const show = (i: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(i);
  };
  const viewer = open !== null && <Lightbox media={media} index={open} onClose={() => setOpen(null)} />;
  const zoom = "block w-full cursor-zoom-in";

  if (media.length === 1) {
    const m = media[0];
    return (
      <div className="relative mt-3 overflow-hidden rounded-2xl border bg-black" style={{ borderColor: X.border }}>
        {m.type === "video" ? (
          <>
            <video src={`${mediaUrl(m)}#t=0.05`} poster={posterUrl(m)} controls preload="metadata" playsInline className="max-h-[560px] w-full bg-black object-contain" />
            <button type="button" onClick={show(0)} title="View larger" className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white/80 transition hover:text-white">
              ⤢ Expand
            </button>
          </>
        ) : (
          <button type="button" onClick={show(0)} title="View larger" className={zoom}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mediaUrl(m)} alt={m.alt ?? ""} className="max-h-[560px] w-full object-contain" />
          </button>
        )}
        {viewer}
      </div>
    );
  }
  return (
    <div className="mt-3 grid grid-cols-2 gap-0.5 overflow-hidden rounded-2xl border" style={{ borderColor: X.border }}>
      {media.slice(0, 4).map((m, i) => (
        <button key={i} type="button" onClick={show(i)} title="View larger" className={`${zoom} relative`}>
          {m.type === "video" ? (
            <>
              <video src={`${mediaUrl(m)}#t=0.05`} poster={posterUrl(m)} preload="metadata" className="aspect-square w-full object-cover" />
              <span className="absolute inset-0 m-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-sm text-white">▶</span>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(m)} alt={m.alt ?? ""} className="aspect-square w-full object-cover" />
          )}
        </button>
      ))}
      {viewer}
    </div>
  );
}

function OnePost({ post, last, expanded, onExpand }: { post: Post; last: boolean; expanded: boolean; onExpand: () => void }) {
  const cut = expanded ? null : foldIndex(post.text);
  const shown = cut === null ? post.text : post.text.slice(0, cut).trimEnd();
  const { quote, link, videoPost } = attachments(post);
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <AuthorAvatar />
        {!last && <div className="mt-1 w-0.5 flex-1" style={{ background: X.border }} />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-4"}`}>
        <div className="flex min-w-0 items-center gap-1 text-[15px] leading-5">
          <AuthorLine />
        </div>
        <div className="whitespace-pre-wrap break-words text-[15px] leading-5" style={{ color: X.text }}>
          <RichText text={shown} />
          {cut !== null && (
            <>
              <span>…</span>
              <button type="button" onClick={onExpand} className="block hover:underline" style={{ color: X.link }}>
                Show more
              </button>
            </>
          )}
        </div>
        {!!post.media?.length && <MediaBlock media={post.media} />}
        {videoPost && <VideoPostCard url={videoPost} />}
        {quote && <QuoteCard url={quote} />}
        {link && <LinkCard url={link} />}
        <Actions />
      </div>
    </div>
  );
}

/** What X draws under a post's text besides its media: the quoted post (converted, or a bare link to a post on X
 *  in a post without media, which X also shows as a quote), else a link card for the first link. */
export function attachments(post: Post): { quote: string | null; link: string | null; videoPost: string | null } {
  if (post.video_post) return { quote: null, link: null, videoPost: post.video_post };
  if (post.quote) return { quote: post.quote, link: null, videoPost: null };
  if (post.media?.length) return { quote: null, link: null, videoPost: null };
  const tl = tweetLinkIn(post.text);
  return tl ? { quote: tl.url, link: null, videoPost: null } : { quote: null, link: firstUrl(post.text), videoPost: null };
}

export default function XPost({
  draft,
  mode = "feed",
  width = "phone",
}: {
  draft: Pick<Draft, "posts">;
  mode?: "feed" | "expanded";
  width?: "phone" | "desktop" | "fill";
}) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  useEffect(() => setOpen({}), [mode]);
  const w = width === "phone" ? "w-[393px]" : width === "desktop" ? "w-[598px]" : "w-full";
  return (
    <div className={`${w} max-w-full rounded-2xl border bg-black px-4 pb-3 pt-3`} style={{ borderColor: X.border, fontFamily: xFont }}>
      {draft.posts.map((p, i) => (
        <OnePost
          key={i}
          post={p}
          last={i === draft.posts.length - 1}
          expanded={mode === "expanded" || !!open[i]}
          onExpand={() => setOpen((o) => ({ ...o, [i]: true }))}
        />
      ))}
    </div>
  );
}
