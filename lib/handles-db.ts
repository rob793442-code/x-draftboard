// Server-only: the @handle directory behind the editor's mention menu (Postgres `handles`). It fills itself: every
// handle typed in a draft is looked up on X once (then re-checked after 30 days), with X_BEARER_TOKEN if set, else
// the connected account's token. With neither, tags just stay unchecked (no red squiggle). Each lookup is a billed
// X API read (see docs/x-api.md); set X_CHECK_HANDLES=off to skip them.
import { sql } from "./db";
import type { XUser } from "./types";
import { answer, cleanHandles, lookupOnX, needsCheck, rank, usageIn, type Dir } from "./handle-core";
import { accessToken } from "./x/account";

type Row = { username: string; profile: XUser | null; missing: string | null; checked_at: Date | string };

async function readDir(names?: string[]): Promise<Dir> {
  const rows = (names ? await sql`select * from handles where username = any(${names}::text[])` : await sql`select * from handles`) as Row[];
  const dir: Dir = { users: {}, missing: {} };
  for (const r of rows) {
    const at = r.checked_at instanceof Date ? r.checked_at.toISOString() : r.checked_at;
    if (r.profile) dir.users[r.username] = r.profile;
    else if (r.missing) dir.missing[r.username] = { at, reason: r.missing };
  }
  return dir;
}

/** Upserts these directory entries (all of them, or just the given handles). */
async function writeDir(dir: Dir, only?: string[]) {
  const keep = only ? new Set(only) : null;
  const rows = [
    ...Object.entries(dir.users).map(([k, u]) => ({ username: k, profile: u, missing: null, checked_at: u.checked_at })),
    ...Object.entries(dir.missing).map(([k, m]) => ({ username: k, profile: null, missing: m.reason, checked_at: m.at })),
  ].filter((r) => !keep || keep.has(r.username));
  if (!rows.length) return 0;
  await sql`
    insert into handles (username, profile, missing, checked_at)
    select username, profile, missing, checked_at from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      as x(username text, profile jsonb, missing text, checked_at timestamptz)
    on conflict (username) do update set profile = excluded.profile, missing = excluded.missing, checked_at = excluded.checked_at
    where handles.checked_at <= excluded.checked_at`;
  return rows.length;
}

/** How often each handle is used across the drafts. */
async function usage(): Promise<Record<string, number>> {
  const rows = (await sql`select p->>'text' as text from drafts d, jsonb_array_elements(d.data->'posts') p`) as { text: string | null }[];
  return usageIn(rows.map((r) => r.text ?? ""));
}

export async function suggestDb(q: string, limit = 6): Promise<XUser[]> {
  const [dir, used] = await Promise.all([readDir(), usage()]);
  return rank(dir.users, used, q, limit);
}

export async function lookupDb(names: string[]): Promise<{ users: Record<string, XUser>; missing: Record<string, string> }> {
  const want = cleanHandles(names);
  if (!want.length) return { users: {}, missing: {} };
  const dir = await readDir(want);
  const todo = process.env.X_CHECK_HANDLES === "off" ? [] : needsCheck(dir, want);
  const token = todo.length ? (process.env.X_BEARER_TOKEN?.trim() || (await accessToken().catch(() => null))) : null;
  if (token && todo.length) {
    try {
      await lookupOnX(token, dir, todo, "lookup");
      await writeDir(dir, todo);
    } catch (e) {
      // No API credits, a rate limit, X having a moment: the tags just stay unchecked this time.
      console.warn("@handle lookup on X failed:", (e as Error).message);
    }
  }
  return answer(dir, want);
}
