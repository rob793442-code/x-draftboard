// Getting approved drafts onto X. Server-only. Two ways out (brand.publishing.method picks the default; anyone who may
// publish can still choose the other one on a draft):
//
//   API             the board posts it through X's API, now or at a scheduled time. Costs per post (lib/x/pricing.ts):
//                   1.5¢, or 20¢ if the post has a link. Needs a connected X account.
//   Post it yourself  free: the board opens X's own composer with the text filled in (X's share links), one post at a
//                   time for a thread, and the person posts or schedules it on X, then marks it posted here.
//
// "smart" (the default) sends posts without links through the API and suggests posting the ones with links yourself,
// which is where nearly all of the API cost is.
//
// Either way, with brand.publishing.requireApproval a draft must be approved and unchanged since. For the API that's
// checked again at the moment of posting, so editing a scheduled draft after approval holds it.
//
// States (drafts.publish_state): scheduled → publishing → posted, or failed; drafts.publish_method says which way.
// An API thread posts one post at a time, each replying to the one before; the ids land in drafts.posted_ids as they
// go, so a thread that fails halfway resumes where it stopped. A draft someone scheduled on X by hand sits in the queue
// as "scheduled in X" and counts as posted once its time passes.
//
// The scheduler is GET /api/cron/publish (Vercel Schedules, GitHub Actions or any pinger; see docs/scheduling.md).
import { sql } from "./db";
import { brand } from "./config";
import { getRow, hashPosts } from "./store";
import { openMedia } from "./storage";
import { overBudget, recordSpend } from "./spend";
import { accessToken, getAccount } from "./x/account";
import { XError, createPost, setAltText, uploadMedia } from "./x/api";
import { X_PRICES, apiCost, hasLink } from "./x/pricing";
import { parseTweetUrl, textFor, tokenize, xLength } from "./xtext";
import { notifyPublished } from "./notify";
import type { Draft, Me, Post } from "./types";
import type { Row } from "./db";

export { textFor };

const MAX_ATTEMPTS = 3;
/** A post stuck in "publishing" this long was cut off (the function timed out); it's marked failed so it can resume. */
const STUCK_MS = 15 * 60_000;

const posted = (row: Row) => (Array.isArray(row.posted_ids) ? (row.posted_ids as string[]).length : 0);

/** Why this draft can't go out right now, or null if it can. `how`: through the API, or posted by hand. */
export async function blocker(row: Row, u: Me | null, how: "api" | "manual" = "api"): Promise<string | null> {
  if (u && !u.can_publish) return "Only admins can post and schedule.";
  if (row.publish_state === "posted") return "This draft is already live on X.";
  if (row.publish_state === "publishing") return "This draft is being posted right now.";
  const d = row.data as Draft;
  if (brand.publishing.requireApproval) {
    if (row.status !== "approved") return "Approve it first.";
    if (row.approved_hash !== hashPosts(d.posts)) return "It was edited after it was approved. Approve it again to post it.";
  }
  const empty = d.posts.findIndex((p) => !p.text.trim() && !p.media?.length && !p.quote && !p.video_post);
  if (empty >= 0) return `Post ${empty + 1} is empty.`;
  if (how === "manual") return null;

  if (brand.publishing.method === "manual") return "This board posts by hand only (publishing.method is \"manual\"). Use Post it yourself.";
  const acct = await getAccount();
  if (!acct) return "No X account is connected for posting through the API. Post it yourself, or an admin can connect one in Settings.";
  // X's API takes at most one $cashtag per post (posting by hand has no such limit).
  const cash = d.posts.findIndex((p) => tokenize(p.text).filter((t) => t.kind === "cashtag").length > 1);
  if (cash >= 0) return `Post ${cash + 1} has more than one $cashtag. X's API only allows one per post; post this one yourself.`;
  if (d.posts.some((p) => (p.media?.length ?? 0) > 4)) return "X allows at most 4 images per post.";
  if (!acct.long_posts) {
    const long = d.posts.findIndex((p) => xLength(textFor(p)) > 280);
    if (long >= 0) return `Post ${long + 1} is over 280 characters, and @${acct.username} can't post long posts (that needs X Premium).`;
  }
  // only what's still to post counts (a thread that failed halfway resumes)
  return overBudget(apiCost(d.posts.slice(posted(row))).total);
}

// ---------------------------------------------------------------- through the API

export async function schedule(id: string, u: Me, when: Date) {
  if (Number.isNaN(when.getTime())) throw new Error("Pick a date and time.");
  if (when.getTime() < Date.now() + 30_000) throw new Error("Pick a time in the future (or use Post now).");
  const row = await getRow(id);
  if (!row) throw new Error("Draft not found.");
  const why = await blocker(row, u, "api");
  if (why) throw new Error(why);
  await sql`update drafts set publish_state = 'scheduled', publish_method = 'api', scheduled_at = ${when.toISOString()}, scheduled_by = ${u.name}, scheduled_by_email = ${u.email},
    publish_error = null, publish_attempts = 0 where id = ${id} and (publish_state is null or publish_state in ('scheduled', 'failed'))`;
}

/** Takes it off the schedule (the board's, or a "scheduled in X" note), or clears a failed attempt. */
export async function unschedule(id: string, u: Me) {
  if (!u.can_publish) throw new Error("Only admins can change the schedule.");
  await sql`update drafts set publish_state = case when posted_ids is not null and jsonb_array_length(posted_ids) > 0 then 'failed' else null end,
    publish_method = case when posted_ids is not null and jsonb_array_length(posted_ids) > 0 then publish_method else null end,
    scheduled_at = null, scheduled_by = null, scheduled_by_email = null, publish_error = null where id = ${id} and publish_state in ('scheduled', 'failed')`;
}

/** Claims the draft for posting (only one request can), so a cron run and a click never post it twice. */
async function claim(id: string): Promise<Row | null> {
  const [r] = await sql`update drafts set publish_state = 'publishing', publish_method = 'api', publish_started_at = now(), publish_attempts = publish_attempts + 1
    where id = ${id} and (publish_state is null or publish_state = 'failed' or (publish_state = 'scheduled' and coalesce(publish_method, 'api') = 'api')) returning *`;
  return r ?? null;
}

/** "Post now". Runs in the request, so the person sees the result (a long video can take a minute or two). */
export async function publishNow(id: string, u: Me) {
  const row = await getRow(id);
  if (!row) throw new Error("Draft not found.");
  const why = await blocker(row, u, "api");
  if (why) throw new Error(why);
  const claimed = await claim(id);
  if (!claimed) throw new Error("Someone else is posting this draft right now.");
  await sql`update drafts set scheduled_by = ${u.name}, scheduled_by_email = ${u.email} where id = ${id}`;
  return run(claimed, false);
}

async function run(row: Row, scheduled: boolean): Promise<{ ok: boolean; url?: string; error?: string }> {
  const id = row.id as string;
  const d = row.data as Draft;
  try {
    const why = await blocker({ ...row, publish_state: null }, null, "api");
    if (why) throw new XError(why, 400, false);
    const acct = (await getAccount())!;
    const token = await accessToken();
    const done: string[] = Array.isArray(row.posted_ids) ? [...(row.posted_ids as string[])] : [];
    for (let i = done.length; i < d.posts.length; i++) {
      const p: Post = d.posts[i];
      const mediaIds: string[] = [];
      for (const m of (p.media ?? []).slice(0, 4)) {
        const mid = await uploadMedia(token, await openMedia(m));
        if (m.alt?.trim()) {
          // alt text is nice to have, not worth failing the post over
          const ok = await setAltText(token, mid, m.alt.trim()).then(() => true, () => false);
          if (ok) await recordSpend("alt_text", X_PRICES.mediaMetadata, id);
        }
        mediaIds.push(mid);
      }
      const postId = await createPost(token, { text: textFor(p), replyTo: done[i - 1], mediaIds });
      await recordSpend(hasLink(p) ? "post_with_link" : "post", hasLink(p) ? X_PRICES.postWithUrl : X_PRICES.post, id);
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

// ---------------------------------------------------------------- posted by hand

/** Someone posted it on X themselves. `link` (optional): the first post's link, so the board can point to it. */
export async function markPosted(id: string, u: Me, link?: string | null) {
  const row = await getRow(id);
  if (!row) throw new Error("Draft not found.");
  const why = await blocker(row, u, "manual");
  if (why) throw new Error(why);
  const tw = link?.trim() ? parseTweetUrl(link) : null;
  if (link?.trim() && !tw) throw new Error("That isn't a link to a post on X (x.com/…/status/…). Leave it empty if you don't have it.");
  await sql`update drafts set publish_state = 'posted', publish_method = 'manual', posted_at = now(), posted_url = ${tw?.url ?? null},
    posted_ids = ${tw ? JSON.stringify([tw.id]) : null}::jsonb, scheduled_at = null, publish_error = null,
    scheduled_by = ${u.name}, scheduled_by_email = ${u.email} where id = ${id}`;
}

/** Someone scheduled it in X's own composer. It waits in the queue as "scheduled in X" and counts as posted after. */
export async function markScheduledInX(id: string, u: Me, at: Date) {
  if (Number.isNaN(at.getTime())) throw new Error("Pick the date and time you scheduled it for.");
  const row = await getRow(id);
  if (!row) throw new Error("Draft not found.");
  const why = await blocker(row, u, "manual");
  if (why) throw new Error(why);
  await sql`update drafts set publish_state = 'scheduled', publish_method = 'manual', scheduled_at = ${at.toISOString()},
    scheduled_by = ${u.name}, scheduled_by_email = ${u.email}, publish_error = null where id = ${id}`;
}

/** Undo "I posted it" (wrong draft, or it didn't go out after all). Only for posts marked by hand. */
export async function unmarkPosted(id: string, u: Me) {
  if (!u.can_publish) throw new Error("Only admins can change this.");
  const done = await sql`update drafts set publish_state = null, publish_method = null, posted_at = null, posted_url = null, posted_ids = null
    where id = ${id} and publish_state = 'posted' and publish_method = 'manual' returning id`;
  if (!done.length) throw new Error("Only a draft marked as posted by hand can be undone. Posts the board made through the API are live on X.");
}

/** Adds (or fixes) the link of a draft posted by hand. */
export async function setPostedLink(id: string, u: Me, link: string) {
  if (!u.can_publish) throw new Error("Only admins can change this.");
  const tw = parseTweetUrl(link);
  if (!tw) throw new Error("That isn't a link to a post on X (x.com/…/status/…).");
  await sql`update drafts set posted_url = ${tw.url}, posted_ids = ${JSON.stringify([tw.id])}::jsonb where id = ${id} and publish_method = 'manual'`;
}

// ---------------------------------------------------------------- the scheduler

/** The scheduler's tick: posts everything due through the API (oldest first), files drafts scheduled in X whose time
 *  has passed under Posted, and frees drafts a cut-off run left behind. */
export async function runDue(limit = 5) {
  await sql`update drafts set publish_state = 'failed', publish_error = 'Posting was interrupted. Retry to finish it (posts already live are skipped).'
    where publish_state = 'publishing' and publish_started_at < now() - make_interval(secs => ${STUCK_MS / 1000})`;
  await sql`update drafts set publish_state = 'posted', posted_at = scheduled_at
    where publish_state = 'scheduled' and publish_method = 'manual' and scheduled_at <= now()`;
  const due = await sql`select id from drafts where publish_state = 'scheduled' and coalesce(publish_method, 'api') = 'api'
    and scheduled_at <= now() order by scheduled_at limit ${limit}`;
  const results: { id: string; ok: boolean; url?: string; error?: string }[] = [];
  for (const r of due) {
    const row = await claim(r.id as string);
    if (row) results.push({ id: row.id as string, ...(await run(row, true)) });
  }
  return results;
}
