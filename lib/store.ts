// Drafts, comments, suggested edits, verdicts and version history (Postgres). Server-only.
import { createHash, randomBytes } from "node:crypto";
import { q, sql, tx, type Row } from "./db";
import { APP_URL } from "./config";
import { compareBoard, planOrder } from "./order";
import { deleteFiles } from "./storage";
import type { Bundle, Comment, Draft, Folder, ListItem, Me, Post, Publish, ReviewStatus, Suggestion, Verdict, VerdictRow, VersionRow } from "./types";
import { FOLDERS, LABELS, UNTITLED, isBlankDraft } from "./types";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : ((v as string | null) ?? null));
const norm = <T>(r: Row): T => {
  const o: Row = { ...r };
  for (const k of ["created_at", "decided_at", "updated_at"]) if (k in o) o[k] = iso(o[k]);
  return o as T;
};

/** A fingerprint of what would be posted: approving stores it, publishing checks the posts still match. */
export const hashPosts = (posts: Post[]) =>
  createHash("sha256")
    .update(JSON.stringify(posts.map((p) => ({ t: p.text, m: (p.media ?? []).map((m) => m.url ?? m.path), q: p.quote ?? null, v: p.video_post ?? null }))))
    .digest("hex")
    .slice(0, 24);

const publishOf = (r: Row): Publish => ({
  state: (r.publish_state as Publish["state"]) ?? null,
  method: (r.publish_method as Publish["method"]) ?? null,
  scheduled_at: iso(r.scheduled_at),
  scheduled_by: (r.scheduled_by as string) ?? null,
  error: (r.publish_error as string) ?? null,
  posted_at: iso(r.posted_at),
  posted_url: (r.posted_url as string) ?? null,
  posted_count: Array.isArray(r.posted_ids) ? r.posted_ids.length : 0,
});

const approvedCurrent = (r: Row) => r.status === "approved" && !!r.approved_hash && r.approved_hash === hashPosts((r.data as Draft).posts);

export async function listDrafts(): Promise<ListItem[]> {
  const rows = await sql`
    select d.*,
      (select count(*) from comments c where c.draft_id = d.id and not c.resolved and c.parent_id is null)::int as open_comments,
      (select count(*) from suggestions s where s.draft_id = d.id and s.state = 'pending')::int as pending_suggestions
    from drafts d order by d.created_at desc`;
  return rows.map((r) => ({
    ...(r.data as Draft),
    folder: r.folder as string,
    title: r.title as string,
    order: (r.position as number | null) ?? null,
    meta: {
      review_status: r.status as ReviewStatus,
      open_comments: r.open_comments as number,
      pending_suggestions: r.pending_suggestions as number,
      created_by: r.created_by as string,
      created_by_name: (r.created_by_name as string) ?? null,
      approved_current: approvedCurrent(r),
      publish: publishOf(r),
    },
  }));
}

export async function getRow(id: string): Promise<Row | null> {
  const [r] = await sql`select * from drafts where id = ${id}`;
  return r ?? null;
}

export async function getBundle(id: string): Promise<Bundle | null> {
  const d = await getRow(id);
  if (!d) return null;
  const [comments, suggestions, verdicts] = await Promise.all([
    sql`select * from comments where draft_id = ${id} order by created_at`,
    sql`select * from suggestions where draft_id = ${id} order by created_at`,
    sql`select * from verdicts where draft_id = ${id} order by created_at`,
  ]);
  return {
    draft: { ...(d.data as Draft), folder: d.folder as string, title: d.title as string },
    review_status: d.status as ReviewStatus,
    created_by: d.created_by as string,
    created_by_name: (d.created_by_name as string) ?? null,
    approved_current: approvedCurrent(d),
    publish: publishOf(d),
    comments: comments.map((r) => norm<Comment>(r)),
    suggestions: suggestions.map((r) => norm<Suggestion>(r)),
    verdicts: verdicts.map((r) => norm<VerdictRow>(r)),
  };
}

/** Saves the draft's copy and adds it to its history. `coalesceMs` (the editor's autosaves): if this person's last
 *  version with the same note is that recent, it's updated in place, so a writing session keeps one version per few
 *  minutes instead of one per pause. Moving to another folder resets the hand-placed position. */
async function writeDraft(d: Draft, who: string, note: string, opts: { coalesceMs?: number } = {}) {
  const next: Draft = { ...d, updated_at: new Date().toISOString() };
  delete next.order;
  const json = JSON.stringify(next);
  await sql`update drafts set data = ${json}::jsonb, title = ${next.title}, folder = ${next.folder},
    position = case when folder = ${next.folder} then position else null end, updated_at = now(), updated_by = ${who} where id = ${d.id}`;
  if (opts.coalesceMs) {
    const done = await sql`update versions set data = ${json}::jsonb
      where id = (select id from versions where draft_id = ${d.id} order by created_at desc, id desc limit 1)
        and author = ${who} and note = ${note} and created_at > now() - make_interval(secs => ${opts.coalesceMs / 1000})
      returning id`;
    if (done.length) return next;
  }
  await sql`insert into versions (draft_id, data, author, note) values (${d.id}, ${json}::jsonb, ${who}, ${note})`;
  return next;
}

/** Who may edit a draft directly: admins, and whoever wrote it. Everyone else suggests edits. */
export const canEdit = (u: Me, createdBy: string | null | undefined) => u.role === "admin" || (!!createdBy && createdBy === u.email);

/** A post as the editor sends it, kept to the fields a post has. */
const cleanPost = (p: Partial<Post>): Post => ({
  text: typeof p.text === "string" ? p.text : "",
  ...(Array.isArray(p.media) && p.media.length ? { media: p.media } : {}),
  ...(p.quote ? { quote: p.quote } : {}),
  ...(p.video_post ? { video_post: p.video_post } : {}),
});

const assertNotLive = (r: Row) => {
  if (r.publish_state === "publishing") throw new Error("This draft is being posted right now.");
  if (r.publish_state === "posted") throw new Error("This draft is already live on X, so its copy can't change here.");
};

export async function addComment(
  id: string,
  u: Me,
  c: { parent_id?: string | null; post_index?: number | null; target?: string; quote?: string | null; prefix?: string | null; suffix?: string | null; start_hint?: number | null; body: string },
) {
  if (!c.body?.trim()) throw new Error("Write a comment first.");
  const [r] = await sql`
    insert into comments (draft_id, parent_id, post_index, target, quote, prefix, suffix, start_hint, body, author_name, author_email)
    values (${id}, ${c.parent_id ?? null}, ${c.post_index ?? null}, ${c.target ?? "text"}, ${c.quote ?? null}, ${c.prefix ?? null}, ${c.suffix ?? null}, ${c.start_hint ?? null}, ${c.body.trim()}, ${u.name}, ${u.email})
    returning *`;
  return norm<Comment>(r);
}

export async function setResolved(commentId: string, u: Me, resolved: boolean) {
  const [r] = await sql`update comments set resolved = ${resolved}, resolved_by = ${resolved ? u.name : null} where id = ${commentId} returning *`;
  return r ? norm<Comment>(r) : null;
}

export async function deleteComment(commentId: string, u: Me) {
  await sql`delete from comments where (id = ${commentId} or parent_id = ${commentId}) and (author_email = ${u.email} or ${u.role === "admin"})`;
}

export async function addSuggestion(id: string, u: Me, s: { post_index: number; base_text: string; proposed_text: string; note?: string | null }) {
  if (s.base_text === s.proposed_text) throw new Error("No change to suggest.");
  const [r] = await sql`
    insert into suggestions (draft_id, post_index, base_text, proposed_text, note, author_name, author_email)
    values (${id}, ${s.post_index}, ${s.base_text}, ${s.proposed_text}, ${s.note ?? null}, ${u.name}, ${u.email}) returning *`;
  return norm<Suggestion>(r);
}

export async function decideSuggestion(sid: string, u: Me, action: "accept" | "reject" | "withdraw") {
  const [s] = await sql`select * from suggestions where id = ${sid}`;
  if (!s) throw new Error("Suggestion not found.");
  if (action === "withdraw") {
    if (s.author_email !== u.email) throw new Error("Only the person who suggested it can withdraw it.");
    await sql`delete from suggestions where id = ${sid}`;
    return null;
  }
  const row = await getRow(s.draft_id as string);
  if (!row) throw new Error("Draft not found.");
  if (!canEdit(u, row.created_by as string)) throw new Error("Only the draft's writer (or an admin) can accept or reject suggestions.");
  if (action === "accept") {
    assertNotLive(row);
    const d = { ...(row.data as Draft), folder: row.folder as string, title: row.title as string };
    const posts = d.posts.map((p, i) => (i === s.post_index ? { ...p, text: s.proposed_text as string } : p));
    await writeDraft({ ...d, posts }, u.name, `Accepted ${s.author_name}'s suggestion on post ${(s.post_index as number) + 1}`);
  }
  const [r] = await sql`update suggestions set state = ${action === "accept" ? "accepted" : "rejected"}, decided_by = ${u.name}, decided_at = now() where id = ${sid} returning *`;
  return norm<Suggestion>(r);
}

export async function addVerdict(id: string, u: Me, verdict: Verdict, reason?: string | null) {
  const row = await getRow(id);
  if (!row) throw new Error("Draft not found.");
  const status: ReviewStatus = verdict === "approve" ? "approved" : verdict === "kill" ? "killed" : "needs_work";
  const hash = verdict === "approve" ? hashPosts((row.data as Draft).posts) : null;
  const [r] = await sql`insert into verdicts (draft_id, verdict, reason, author_name, author_email) values (${id}, ${verdict}, ${reason?.trim() || null}, ${u.name}, ${u.email}) returning *`;
  // Killing or sending back a scheduled draft takes it off the schedule.
  await sql`update drafts set status = ${status}, approved_hash = ${hash}, updated_at = now(), updated_by = ${u.name},
    publish_state = case when ${verdict !== "approve"} and publish_state = 'scheduled' then null else publish_state end,
    scheduled_at = case when ${verdict !== "approve"} and publish_state = 'scheduled' then null else scheduled_at end
    where id = ${id}`;
  return norm<VerdictRow>(r);
}

/** A direct edit (the writer or an admin): posts with media, quotes and video posts, title, label and folder. */
export async function editDraft(id: string, u: Me, patch: Partial<Draft>, opts: { autosave?: boolean } = {}) {
  const row = await getRow(id);
  if (!row) throw new Error("Draft not found.");
  if (!canEdit(u, row.created_by as string)) throw new Error("Only the person who wrote this draft (or an admin) can edit it. Use Suggest.");
  const d: Draft = { ...(row.data as Draft), folder: row.folder as string, title: row.title as string };
  const allowed: Partial<Draft> = {};
  if (typeof patch.title === "string") allowed.title = patch.title.trim() || UNTITLED;
  if (Array.isArray(patch.posts) && patch.posts.length) allowed.posts = patch.posts.map(cleanPost);
  if ("label" in patch) allowed.label = LABELS.includes(patch.label as string) ? patch.label : undefined;
  if (patch.folder && FOLDERS.some((f) => f.key === patch.folder)) allowed.folder = patch.folder;
  if (allowed.posts && hashPosts(allowed.posts) !== hashPosts(d.posts)) assertNotLive(row);
  const note = Object.keys(allowed).length === 1 && "title" in allowed ? "Renamed" : "Edited";
  return writeDraft({ ...d, ...allowed }, u.name, note, opts.autosave ? { coalesceMs: 5 * 60_000 } : {});
}

/** "New draft": a blank draft in that folder, written by `u`. It shows in the Inbox once it has words in it. */
export async function createDraft(u: Me, opts: { folder?: Folder; label?: string } = {}): Promise<ListItem> {
  const folder = FOLDERS.some((f) => f.key === opts.folder) ? opts.folder! : FOLDERS[0].key;
  const id = randomBytes(6).toString("base64url").replace(/[-_]/g, "x").toLowerCase();
  const now = new Date().toISOString();
  const d: Draft = {
    id,
    folder,
    title: UNTITLED,
    ...(LABELS.includes(opts.label as string) ? { label: opts.label } : {}),
    posts: [{ text: "" }],
    created_at: now,
    updated_at: now,
  };
  await sql`insert into drafts (id, folder, title, status, data, created_by, created_by_name, updated_by)
    values (${id}, ${folder}, ${d.title}, 'in_review', ${JSON.stringify(d)}::jsonb, ${u.email}, ${u.name}, ${u.name})`;
  await sql`insert into versions (draft_id, data, author, note) values (${id}, ${JSON.stringify(d)}::jsonb, ${u.name}, 'Started')`;
  return {
    ...d,
    order: null,
    meta: { review_status: "in_review", open_comments: 0, pending_suggestions: 0, created_by: u.email, created_by_name: u.name, approved_current: false, publish: publishOf({}) },
  };
}

/** Claims the one "new draft" announcement for a draft `u` wrote, once it has words in it. Returns the draft when this
 *  call won it (so it's sent once even if two requests race), else null. */
export async function claimAnnouncement(id: string, u: Me): Promise<Draft | null> {
  const [d] = await sql`select data from drafts where id = ${id} and created_by = ${u.email} and announced_at is null`;
  if (!d || isBlankDraft(d.data as Draft)) return null;
  const won = await sql`update drafts set announced_at = now() where id = ${id} and announced_at is null returning id`;
  return won.length ? (d.data as Draft) : null;
}

export async function listVersions(id: string): Promise<VersionRow[]> {
  const rows = await sql`select id, draft_id, data, author, note, created_at from versions where draft_id = ${id} order by created_at desc, id desc limit 50`;
  return rows.map((r) => norm<VersionRow>(r));
}

export async function restoreVersion(id: string, versionId: number, u: Me) {
  const row = await getRow(id);
  if (!row) throw new Error("Draft not found.");
  if (!canEdit(u, row.created_by as string)) throw new Error("Only the draft's writer (or an admin) can restore a version.");
  assertNotLive(row);
  const [v] = await sql`select data from versions where id = ${versionId} and draft_id = ${id}`;
  if (!v) throw new Error("Version not found.");
  // A restore brings back the copy, not the folder: the draft stays where it was dragged to.
  return writeDraft({ ...(v.data as Draft), folder: row.folder as string }, u.name, `Restored version #${versionId}`);
}

// Share links: a link with the draft's secret (?draft=<id>&s=<token>) lets link unfurlers (Slack, Discord, iMessage)
// read the copy and first image without signing in. The page itself still needs a sign-in.
export const shareUrl = (id: string, token: string) => `${APP_URL}/?draft=${encodeURIComponent(id)}&s=${token}`;

export async function ensureShareUrl(id: string): Promise<string | null> {
  const fresh = randomBytes(9).toString("base64url");
  const [r] = await sql`update drafts set share_token = coalesce(share_token, ${fresh}) where id = ${id} returning share_token`;
  return r ? shareUrl(id, r.share_token as string) : null;
}

/** What a share link may show: the draft and its review status, only when the token matches. */
export async function getShared(id: string, token: string): Promise<{ draft: Draft; review_status: ReviewStatus } | null> {
  if (!id || !token) return null;
  const [r] = await sql`select data, title, folder, status from drafts where id = ${id} and share_token = ${token}`;
  return r ? { draft: { ...(r.data as Draft), title: r.title as string, folder: r.folder as string }, review_status: r.status as ReviewStatus } : null;
}

/**
 * Admins, drag and drop: put the draft in `folder` at its place in `ids`, the board's top-to-bottom list of that
 * folder. Only the folder and `position` change (no new version). Ids the board sent that the folder doesn't have are
 * ignored; drafts the board didn't list yet keep their place.
 */
export async function moveDraft(id: string, folder: Folder, ids: string[], u: Me) {
  if (u.role !== "admin") throw new Error("Only an admin can rearrange drafts.");
  const rows = await sql`select id, folder, title, position, created_at from drafts where folder = ${folder} or id = ${id}`;
  const me = rows.find((r) => r.id === id);
  if (!me) throw new Error("Draft not found.");
  const item = (r: Row) => ({ id: r.id as string, title: r.title as string, order: (r.position as number | null) ?? null, created_at: iso(r.created_at)! });
  const group = rows.filter((r) => r.id !== id && r.folder === folder).map(item).sort(compareBoard);
  const known = new Set(group.map((x) => x.id));
  const wanted = [...new Set(ids)].filter((x) => x === id || known.has(x));
  if (!wanted.includes(id)) wanted.push(id);
  const order = [...wanted, ...group.filter((x) => !wanted.includes(x.id)).map((x) => x.id)];
  const byId = new Map([...group, item(me)].map((x) => [x.id, x]));
  const changes = planOrder(order.map((x) => byId.get(x)!), id);
  const position = id in changes ? changes[id] : ((me.position as number | null) ?? null);
  await tx([
    ...Object.entries(changes)
      .filter(([x]) => x !== id)
      .map(([x, v]) => q`update drafts set position = ${v} where id = ${x}`),
    q`update drafts set folder = ${folder}, data = jsonb_set(data, '{folder}', to_jsonb(${folder}::text)), position = ${position} where id = ${id}`,
  ]);
  return { id, folder, position, changed: Object.keys(changes).length };
}

/** Admins: delete a draft for good, with its comments, suggestions, verdicts, versions and share link, plus its
 *  uploaded media unless another draft still uses the same file. */
export async function deleteDraft(id: string, u: Me) {
  if (u.role !== "admin") throw new Error("Only an admin can delete a draft.");
  return purge(id);
}

/** The editor throwing away a draft its writer left without writing anything. Only an empty draft that person
 *  started, with no comments, suggestions or verdicts on it. */
export async function discardBlank(id: string, u: Me) {
  const [d] = await sql`select data, created_by,
      exists(select 1 from comments where draft_id = ${id}) or exists(select 1 from suggestions where draft_id = ${id})
        or exists(select 1 from verdicts where draft_id = ${id}) as touched
    from drafts where id = ${id}`;
  if (!d) throw new Error("Draft not found.");
  if (d.created_by !== u.email || d.touched || !isBlankDraft(d.data as Draft)) throw new Error("Only an empty draft you started can be discarded.");
  return purge(id);
}

async function purge(id: string) {
  const [d] = await sql`select data::text as data, publish_state from drafts where id = ${id}`;
  if (!d) throw new Error("Draft not found.");
  if (d.publish_state === "publishing") throw new Error("This draft is being posted right now. Try again in a minute.");
  const versions = await sql`select data::text as data from versions where draft_id = ${id}`;
  const files = new Set(
    [d.data as string, ...versions.map((v) => v.data as string)].flatMap((t) => {
      const posts = ((JSON.parse(t) as Draft).posts ?? []) as Post[];
      return posts.flatMap((p) => (p.media ?? []).flatMap((m) => [m.url, m.poster_url].filter((x): x is string => !!x)));
    }),
  );
  await sql`delete from drafts where id = ${id}`;
  // Only delete files no remaining draft or version points at.
  const orphans: string[] = [];
  for (const url of files) {
    const [r] = await sql`select exists(select 1 from drafts where position(${url} in data::text) > 0)
      or exists(select 1 from versions where position(${url} in data::text) > 0) as used`;
    if (!r.used) orphans.push(url);
  }
  if (orphans.length) await deleteFiles(orphans).catch((e) => console.error("media cleanup failed:", (e as Error).message));
  return { id, media_deleted: orphans.length };
}
