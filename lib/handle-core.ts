// The @handle directory's shared parts (no database access): ranking for the mention menu and the X lookup.
import type { XUser } from "./types";

export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
export const MENTION_RE = /(?:^|[^A-Za-z0-9_.])@([A-Za-z0-9_]{1,15})/g;
export const FIELDS = "profile_image_url,verified,verified_type,public_metrics";
export const STALE_MS = 30 * 864e5; // re-check a known profile after 30 days
export const MISSING_MS = 3 * 864e5; // re-check a handle that wasn't found after 3 days

export type Dir = { users: Record<string, XUser>; missing: Record<string, { at: string; reason: string }> };
export type ApiUser = { username: string; name: string; profile_image_url?: string; verified?: boolean; verified_type?: string; public_metrics?: { followers_count?: number } };

export function toUser(u: ApiUser, sources: string[], prev?: XUser): XUser {
  return {
    username: u.username,
    name: u.name,
    // _normal is 48px; _bigger (73px) stays sharp at 2x
    avatar: u.profile_image_url?.replace("_normal.", "_bigger."),
    verified: !!u.verified,
    verified_type: u.verified_type && u.verified_type !== "none" ? u.verified_type : undefined,
    followers: u.public_metrics?.followers_count,
    checked_at: new Date().toISOString(),
    sources: [...new Set([...(prev?.sources ?? []), ...sources])],
  };
}

/** X API v2 GET (an app-only bearer token or a user token). */
export async function xApi(token: string, p: string, params: Record<string, string>) {
  const base = (process.env.X_API_URL ?? "https://api.x.com/2").replace(/\/$/, "");
  const r = await fetch(`${base}/${p}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`X API ${p} -> ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j as { data?: ApiUser[]; errors?: { value?: string; title?: string; detail?: string }[] };
}

/** Looks these handles up on X (≤100 per call) and records what it finds in `dir`. */
export async function lookupOnX(token: string, dir: Dir, handles: string[], source: string) {
  for (let i = 0; i < handles.length; i += 100) {
    const batch = handles.slice(i, i + 100);
    const j = await xApi(token, "users/by", { usernames: batch.join(","), "user.fields": FIELDS });
    for (const u of j.data ?? []) {
      const k = u.username.toLowerCase();
      dir.users[k] = toUser(u, [source], dir.users[k]);
      delete dir.missing[k];
    }
    for (const e of j.errors ?? []) {
      const k = e.value?.toLowerCase();
      if (!k) continue;
      // "Not Found Error" or "Forbidden" (suspended); either way the tag won't resolve
      dir.missing[k] = { at: new Date().toISOString(), reason: /suspend/i.test(e.detail ?? "") ? "suspended" : "not found" };
      delete dir.users[k];
    }
  }
}

/** Which of these handles need a (re)check on X: never seen, or seen too long ago. */
export function needsCheck(dir: Dir, handles: string[]): string[] {
  const now = Date.now();
  return handles.filter((n) => {
    const u = dir.users[n];
    if (u) return now - Date.parse(u.checked_at) > STALE_MS;
    const m = dir.missing[n];
    return !m || now - Date.parse(m.at) > MISSING_MS;
  });
}

/** Lowercase, deduped, valid handles from what was asked for. */
export const cleanHandles = (names: string[]) => [...new Set(names.map((n) => n.replace(/^@/, "").toLowerCase()).filter((n) => HANDLE_RE.test(n)))];

/** How often each handle appears across these posts (lowercase keys). */
export function usageIn(texts: string[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const t of texts) for (const m of t.matchAll(MENTION_RE)) c[m[1].toLowerCase()] = (c[m[1].toLowerCase()] ?? 0) + 1;
  return c;
}

const BONUS: Record<string, number> = {};

/** Directory matches for a partial handle or name, best first. */
export function rank(users: Record<string, XUser>, used: Record<string, number>, q: string, limit = 6): XUser[] {
  const qq = q.replace(/^@/, "").toLowerCase();
  const scored: { u: XUser; s: number }[] = [];
  for (const [k, u] of Object.entries(users)) {
    // A profile we only looked up (e.g. a half-typed handle) isn't a suggestion until a draft uses it.
    const curated = (u.sources ?? []).some((s) => s !== "lookup") || (used[k] ?? 0) > 0;
    if (!curated && k !== qq) continue;
    const name = u.name.toLowerCase();
    let s: number;
    if (!qq) s = 100;
    else if (k === qq) s = 1000;
    else if (k.startsWith(qq)) s = 600 - (k.length - qq.length);
    else if (name.startsWith(qq) || name.split(/[\s._-]+/).some((w) => w.startsWith(qq))) s = 400;
    else if (k.includes(qq)) s = 250;
    else if (name.replace(/\s+/g, "").includes(qq)) s = 200;
    else continue;
    s += Math.min(used[k] ?? 0, 10) * 15;
    for (const src of u.sources ?? []) s += BONUS[src] ?? 0;
    s += Math.log10((u.followers ?? 0) + 1) * 4;
    // an exact handle we only looked up (never used) goes after the accounts we know
    if (!curated) s = 1;
    scored.push({ u, s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.u);
}

/** What /api/handles?u= answers: the profile for each handle we know, and why the others don't resolve. */
export function answer(dir: Dir, want: string[]): { users: Record<string, XUser>; missing: Record<string, string> } {
  const users: Record<string, XUser> = {};
  const missing: Record<string, string> = {};
  for (const n of want) {
    if (dir.users[n]) users[n] = dir.users[n];
    else if (dir.missing[n]) missing[n] = dir.missing[n].reason;
  }
  return { users, missing };
}
