"use client";
// @mentions in the editor: autocomplete, a check that each tag is a real X account, and the "Tagged on X" list in
// the sidebar. Profiles come from /api/handles.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { XUser } from "@/lib/types";
import { X } from "./XPost";

export type Profile = XUser | { missing: string };
export const isMissing = (p: Profile | undefined): p is { missing: string } => !!p && "missing" in p;

// ---------- profile cache shared by every editor on the page ----------
const profiles = new Map<string, Profile>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** A profile picked from the menu is known already; no need to look it up again. */
export function rememberProfile(u: XUser) {
  profiles.set(u.username.toLowerCase(), u);
  emit();
}

/** Looks up handles not seen yet (one request for the batch). */
export async function checkHandles(handles: string[]) {
  const todo = [...new Set(handles.map((h) => h.toLowerCase()))].filter((h) => !profiles.has(h) && !inflight.has(h));
  if (!todo.length) return;
  todo.forEach((h) => inflight.add(h));
  try {
    const r = await fetch(`/api/handles?u=${todo.join(",")}`);
    if (!r.ok) return;
    const j = (await r.json()) as { users: Record<string, XUser>; missing: Record<string, string> };
    for (const [k, u] of Object.entries(j.users ?? {})) profiles.set(k, u);
    for (const [k, why] of Object.entries(j.missing ?? {})) profiles.set(k, { missing: why });
    emit();
  } catch {
    // offline or no token: tags just stay unchecked
  } finally {
    todo.forEach((h) => inflight.delete(h));
  }
}

/** Profiles for these handles; checks unknown ones after typing settles. */
export function useProfiles(handles: string[], delay = 900): Map<string, Profile> {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const key = [...new Set(handles.map((h) => h.toLowerCase()))].sort().join(",");
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => checkHandles(key.split(",")), delay);
    return () => clearTimeout(t);
  }, [key, delay]);
  return profiles;
}

// ---------- autocomplete ----------
const suggestCache = new Map<string, XUser[]>();
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/** Suggestions for what's typed after "@": directory matches right away, then (after a pause) a live
 *  check of the exact handle on X, so a handle we've never used can still be confirmed. */
export function useMentionSuggest(query: string | null): { items: XUser[]; loading: boolean; notOnX: boolean } {
  const [items, setItems] = useState<XUser[]>([]);
  const [loading, setLoading] = useState(false);
  const prev = useRef<string | null>(null);
  useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => {
    const was = prev.current;
    prev.current = query === null ? null : query.toLowerCase();
    if (query === null) return;
    const q = query.toLowerCase();
    let on = true;
    const cached = suggestCache.get(q);
    // keep the list while typing more of the same handle; a new @ starts empty
    if (cached) setItems(cached);
    else if (was === null || !q.startsWith(was)) setItems([]);
    setLoading(!cached);
    const t = setTimeout(
      () =>
        fetch(`/api/handles?q=${encodeURIComponent(q)}&limit=6`)
          .then((r) => r.json())
          .then((j) => {
            suggestCache.set(q, j.users ?? []);
            if (on) setItems(j.users ?? []);
          })
          .catch(() => {})
          .finally(() => on && setLoading(false)),
      cached ? 0 : 90,
    );
    // live check of the exact handle once typing pauses
    const live = q.length >= 2 && HANDLE_RE.test(q) ? setTimeout(() => checkHandles([q]), 450) : undefined;
    return () => {
      on = false;
      clearTimeout(t);
      clearTimeout(live);
    };
  }, [query]);
  if (query === null) return { items: [], loading: false, notOnX: false };
  const q = query.toLowerCase();
  const exact = profiles.get(q);
  let out = items;
  if (exact && !isMissing(exact) && !items.some((u) => u.username.toLowerCase() === q)) out = [...items.slice(0, 5), exact];
  return { items: out, loading, notOnX: isMissing(exact) && !items.length };
}

// ---------- bits of UI ----------
export function VerifiedMark({ type, size = 16 }: { type?: string; size?: number }) {
  const fill = type === "business" ? "#E2B719" : type === "government" ? "#829AAB" : "#1D9BF0";
  const tick = type === "business" ? "#14192C" : "#fff";
  return (
    <svg viewBox="0 0 22 22" width={size} height={size} className="shrink-0" aria-label={`Verified${type ? ` (${type})` : ""}`}>
      <path
        fill={fill}
        d="M20.4 11c0-1.3-.8-2.4-2-3 .4-1.3.2-2.7-.8-3.6s-2.3-1.2-3.6-.8c-.6-1.2-1.7-2-3-2s-2.4.8-3 2c-1.3-.4-2.7-.2-3.6.8S3.2 6.7 3.6 8c-1.2.6-2 1.7-2 3s.8 2.4 2 3c-.4 1.3-.2 2.7.8 3.6s2.3 1.2 3.6.8c.6 1.2 1.7 2 3 2s2.4-.8 3-2c1.3.4 2.7.2 3.6-.8s1.2-2.3.8-3.6c1.2-.6 2-1.7 2-3z"
      />
      <path fill={tick} d="M9.6 14.6 6.5 11.5l1.3-1.3 1.8 1.8 4.6-4.9 1.3 1.2z" />
    </svg>
  );
}

export const compact = (n?: number) =>
  n === undefined ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n);

function Avatar({ u, size = 32 }: { u?: XUser; size?: number }) {
  return u?.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={u.avatar} alt="" width={size} height={size} className="shrink-0 rounded-full bg-white/10" style={{ width: size, height: size }} />
  ) : (
    <span className="shrink-0 rounded-full bg-white/10" style={{ width: size, height: size }} />
  );
}

/** The dropdown under the caret while typing @… */
export function MentionMenu({
  items,
  active,
  loading,
  notOnX,
  query,
  pos,
  onPick,
  onHover,
}: {
  items: XUser[];
  active: number;
  loading: boolean;
  notOnX: boolean;
  query: string;
  pos: { top: number; left: number };
  onPick: (u: XUser) => void;
  onHover: (i: number) => void;
}) {
  return (
    <div
      role="listbox"
      className="absolute z-30 w-[300px] overflow-hidden rounded-xl border bg-black py-1 text-[14px] shadow-[0_8px_28px_rgba(255,255,255,0.08)]"
      style={{ top: pos.top, left: pos.left, borderColor: X.border, fontFamily: "inherit" }}
      // keep focus (and the caret) in the post while clicking a row
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((u, i) => (
        <button
          key={u.username}
          type="button"
          role="option"
          aria-selected={i === active}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(u)}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${i === active ? "bg-white/[0.08]" : ""}`}
        >
          <Avatar u={u} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className="truncate font-bold" style={{ color: X.text }}>
                {u.name}
              </span>
              {u.verified && <VerifiedMark type={u.verified_type} size={15} />}
            </span>
            <span className="block truncate text-[13px]" style={{ color: X.muted }}>
              @{u.username}
              {u.followers !== undefined && <span> · {compact(u.followers)} followers</span>}
            </span>
          </span>
        </button>
      ))}
      {!items.length && (
        <div className="px-3 py-2 text-[13px]" style={{ color: X.muted }}>
          {loading ? "Searching…" : notOnX ? `@${query} isn't an account on X` : query ? "No match yet. Type the full handle to check it on X." : "Type a handle or name"}
        </div>
      )}
    </div>
  );
}

/** Sidebar list of every @tag in the draft: who it resolves to on X, linked to the profile. */
export function TaggedList({ handles }: { handles: string[] }) {
  const uniq: string[] = [];
  for (const h of handles) if (!uniq.some((x) => x.toLowerCase() === h.toLowerCase())) uniq.push(h);
  const map = useProfiles(uniq, 600);
  if (!uniq.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {uniq.map((h) => {
        const p = map.get(h.toLowerCase());
        const href = `https://x.com/${h}`;
        if (isMissing(p))
          return (
            <a key={h} href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-500/[0.07] px-2 py-1.5 text-xs hover:border-rose-300/60" title="Open on X to double-check">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-300">!</span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-rose-200">@{h}</span>
                <span className="block text-[11px] text-rose-300/80">{p.missing === "suspended" ? "Suspended on X" : "Not an account on X"}</span>
              </span>
            </a>
          );
        return (
          <a key={h} href={href} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-white/[0.05]" title={`Open @${h} on X`}>
            <Avatar u={p} size={28} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className="truncate font-medium text-white/85">{p ? p.name : `@${h}`}</span>
                {p?.verified && <VerifiedMark type={p.verified_type} size={13} />}
              </span>
              <span className="block truncate text-[11px] text-[#1D9BF0] group-hover:underline">
                @{p ? p.username : h}
                {p?.followers !== undefined && <span className="text-white/35"> · {compact(p.followers)}</span>}
              </span>
            </span>
            <span className="text-white/25 group-hover:text-white/60">↗</span>
          </a>
        );
      })}
    </div>
  );
}
