// Posting drafts to X, now or on a schedule. Server-only.
//
// A draft is publishable when an X account is connected, the person may publish (brand.publishing.whoCanPublish),
// and, with brand.publishing.requireApproval, it's approved and its posts haven't changed since. That last check runs
// again at the moment of posting, so editing a scheduled draft after approval holds it until someone approves again.
//
// States (drafts.publish_state): scheduled → publishing → posted, or failed. A thread posts one post at a time,
// each replying to the one before; the ids land in drafts.posted_ids as they go, so a thread that fails halfway
// resumes where it stopped instead of posting the first half twice.
//
// The scheduler is GET /api/cron/publish (Vercel Cron, GitHub Actions or any pinger; see docs/scheduling.md).
import { sql } from "./db";
import { brand } from "./config";
import { getRow, hashPosts } from "./store";
import { openMedia } from "./storage";
import { accessToken, getAccount } from "./x/account";
import { XError, createPost, setAltText, uploadMedia } from "./x/api";
import { tokenize, xLength } from "./xtext";
import { notifyPublished } from "./notify";
import type { Draft, Me, Post } from "./types";
import type { Row } from "./db";

const MAX_ATTEMPTS = 3;

/**
 * What goes out as the post's text. X's API only lets Enterprise apps attach a quote (quote_tweet_id), so a quoted
 * post, or a video post, goes out the way X's own composer does it: the link to the post at the end of the text, which
 * X shows as the quote card. (X bills a post with a link at its higher "post with URL" rate.)
 */
export function textFor(p: Post): string {
  const ref = p.quote ?? p.video_post;
  const text = p.text.trim();
  return ref ? (text ? `${text}\n\n${ref}` : ref) : text;
}
/** A post stuck in "publishing" this long was cut off (the function timed out); it's marked failed so it can resume. */
const STUCK_MS = 15 * 60_000;

/** Why this draft can't be posted right now, or null if it can. */
export async function blocker(row: Row, u?: Me): Promise<string | null> {
  if (u && !u.can_publish) return "Only admins can post and schedule.";
  if (row.publish_state === "posted") return "This draft is already live on X.";
  if (row.publish_state === "publishing") return "This draft is being posted right now.";
  const d = row.data as Draft;
  if (brand.publishing.requireApproval) {
    if (row.status !== "approved") return "Approve it first.";
    if (row.approved_hash !== hashPosts(d.posts)) return "It was edited after it was approved. Approve it again to post it.";
  }
  const acct = await getAccount();
  if (!acct) return "No X account is connected yet. An admin can connect one in Settings.";
  const empty = d.posts.findIndex((p) => !p.text.trim() && !p.media?.length && !p.quote && !p.video_post);
  if (empty >= 0) return `Post ${empty + 1} is empty.`;
  // X's API takes at most one $cashtag per post.
  const cash = d.posts.findIndex((p) => tokenize(p.text).filter((t) => t.kind === "cashtag").length > 1);
  if (cash >= 0) return `Post ${cash + 1} has more than one $cashtag. X only allows one per post made through its API.`;
  if (d.posts.some((p) => (p.media?.length ?? 0) > 4)) return "X allows at most 4 images per post.";
  if (!acct.long_posts) {
    const long = d.posts.findIndex((p) => xLength(textFor(p)) > 280);
    if (long >= 0) return `Post ${long + 1} is over 280 characters, and @${acct.username} can't post long posts (that needs X Premium).`;
  }
  return null;
}

export async function schedule(id: string, u: Me, when: Date) {
  if (Number.isNaN(when.getTime())) throw new Error("Pick a date and time.");
  if (when.getTime() < Date.now() + 30_000) throw new Error("Pick a time in the future (or use Post now).");
  const row = await getRow(id);
  if (!row) throw new Error("Draft not found.");
  const why = await blocker(row, u);
  if (why) throw new Error(why);
  await sql`update drafts set publish_state = 'scheduled', scheduled_at = ${when.toISOString()}, scheduled_by = ${u.name}, scheduled_by_email = ${u.email},
    publish_error = null, publish_attempts = 0 where id = ${id} and (publish_state is null or publish_state in ('scheduled', 'failed'))`;
}

export async function unschedule(id: string, u: Me) {
  if (!u.can_publish) throw new Error("Only admins can change the schedule.");
  await sql`update drafts set publish_state = case when posted_ids is not null and jsonb_array_length(posted_ids) > 0 then 'failed' else null end,
    scheduled_at = null, scheduled_by = null, scheduled_by_email = null, publish_error = null where id = ${id} and publish_state in ('scheduled', 'failed')`;
}

/** Claims the draft for posting (only one request can), so a cron run and a click never post it twice. */
async function claim(id: string): Promise<Row | null> {
  const [r] = await sql`update drafts set publish_state = 'publishing', publish_started_at = now(), publish_attempts = publish_attempts + 1
    where id = ${id} and (publish_state is null or publish_state in ('scheduled', 'failed')) returning *`;
  return r ?? null;
}

/** "Post now". Runs in the request, so the person sees the result (a long video can take a minute or two). */
export async function publishNow(id: string, u: Me) {
  const row = await getRow(id);
  if (!row) throw new Error("Draft not found.");
  const why = await blocker(row, u);
  if (why) throw new Error(why);
  const claimed = await claim(id);
  if (!claimed) throw new Error("Someone else is posting this draft right now.");
  if (!claimed.scheduled_by) await sql`update drafts set scheduled_by = ${u.name}, scheduled_by_email = ${u.email} where id = ${id}`;
  return run(claimed, false);
}

async function run(row: Row, scheduled: boolean): Promise<{ ok: boolean; url?: string; error?: string }> {
  const id = row.id as string;
  const d = row.data as Draft;
  try {
    const why = await blocker({ ...row, publish_state: null });
    if (why) throw new XError(why, 400, false);
    const acct = (await getAccount())!;
    const token = await accessToken();
    const done: string[] = Array.isArray(row.posted_ids) ? [...(row.posted_ids as string[])] : [];
    for (let i = done.length; i < d.posts.length; i++) {
      const p: Post = d.posts[i];
      const mediaIds: string[] = [];
      for (const m of (p.media ?? []).slice(0, 4)) {
        const mid = await uploadMedia(token, await openMedia(m));
        if (m.alt?.trim()) await setAltText(token, mid, m.alt.trim()).catch(() => {}); // alt text is nice to have, not worth failing the post
        mediaIds.push(mid);
      }
      const postId = await createPost(token, { text: textFor(p), replyTo: done[i - 1], mediaIds });
      done.push(postId);
      await sql`update drafts set posted_ids = ${JSON.stringify(done)}::jsonb where id = ${id}`;
    }
    const url = `https://x.com/${acct.username}/status/${done[0]}`;
    await sql`update drafts set publish_state = 'posted', posted_at = now(), posted_url = ${url}, publish_error = null where id = ${id}`;
    notifyPublished(id, { ok: true, url });
    return { ok: true, url };
  } catch (e) {
    const err = e as Error;
    const retry = scheduled && err instanceof XError && err.retryable && Number(row.publish_attempts) < MAX_ATTEMPTS;
    if (retry) {
      // Rate limit or X hiccup on a scheduled post: try again in a few minutes.
      const later = new Date(Date.now() + 5 * 60_000 * Number(row.publish_attempts)).toISOString();
      await sql`update drafts set publish_state = 'scheduled', scheduled_at = ${later}, publish_error = ${`${err.message} (retrying)`} where id = ${id}`;
    } else {
      await sql`update drafts set publish_state = 'failed', publish_error = ${err.message} where id = ${id}`;
      notifyPublished(id, { ok: false, error: err.message });
    }
    return { ok: false, error: err.message };
  }
}

/** The scheduler's tick: posts everything that's due (oldest first), and frees drafts a cut-off run left behind. */
export async function runDue(limit = 5) {
  await sql`update drafts set publish_state = 'failed', publish_error = 'Posting was interrupted. Retry to finish it (posts already live are skipped).'
    where publish_state = 'publishing' and publish_started_at < now() - make_interval(secs => ${STUCK_MS / 1000})`;
  const due = await sql`select id from drafts where publish_state = 'scheduled' and scheduled_at <= now() order by scheduled_at limit ${limit}`;
  const results: { id: string; ok: boolean; url?: string; error?: string }[] = [];
  for (const r of due) {
    const row = await claim(r.id as string);
    if (row) results.push({ id: row.id as string, ...(await run(row, true)) });
  }
  return results;
}
