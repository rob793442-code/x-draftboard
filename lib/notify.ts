// Slack DMs from your own Slack app (optional; docs/slack.md). Whoever is involved hears about it, never the person
// who acted:
//   a comment          the draft's writer, plus anyone it @tags
//   a reply            everyone in that thread, the writer, plus anyone it @tags
//   a suggested edit   the writer (they accept or reject it)
//   a verdict          the writer, and admins when it's approved (they're the ones who post it)
//   a resolved thread  everyone in that thread
//   accept / decline   the person who suggested the edit
//   a new draft        admins, once, the first time its writer steps away from it with words in it
//   posted / failed    the writer and whoever scheduled it
//
// Env: SLACK_BOT_TOKEN (the app's bot token, scope chat:write) and SLACK_USERS (email=SlackID pairs, lib/people.ts).
// SLACK_API_URL points somewhere else for local testing. Sending runs after the response; a Slack failure never
// breaks the action that triggered it.
import { after } from "next/server";
import { sql } from "./db";
import { ADMIN_EMAILS, APP_URL } from "./config";
import { mentionedIn, slackIds, slackOn, taggablePeople } from "./people";
import { claimAnnouncement } from "./store";
import type { Draft, Me, Verdict } from "./types";
import { UNTITLED, folderOf } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s: string, n = 500) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const quoted = (s: string, n = 500) =>
  esc(clip(s.trim(), n))
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
const link = (id: string) => `<${APP_URL}/?draft=${encodeURIComponent(id)}|Open the draft>`;

/** The part of a post an edit changes, with a little shared context on each side (cut at word boundaries). */
function changedSpan(a: string, b: string, ctx = 40) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  let start = Math.max(0, p - ctx);
  while (start > 0 && !/\s/.test(a[start - 1])) start--;
  const tailFull = a.slice(a.length - s);
  let end = Math.min(tailFull.length, ctx);
  while (end < tailFull.length && !/\s/.test(tailFull[end])) end++;
  const head = (start > 0 ? "…" : "") + a.slice(start, p);
  const tail = tailFull.slice(0, end) + (end < tailFull.length ? "…" : "");
  return { before: head + a.slice(p, a.length - s) + tail, after: head + b.slice(p, b.length - s) + tail };
}

export async function sendSlack(text: string, channel: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !channel) return { ok: false, error: "SLACK_BOT_TOKEN or the recipient is not set" };
  try {
    const res = await fetch(`${(process.env.SLACK_API_URL ?? "https://slack.com/api").replace(/\/$/, "")}/chat.postMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return j.ok ? { ok: true } : { ok: false, error: j.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Sends each recipient (by email) their message, skipping the actor and anyone without a Slack ID. */
function deliver(actor: string | null, build: () => Promise<Map<string, string>>) {
  if (!slackOn()) return;
  after(async () => {
    try {
      const ids = slackIds();
      for (const [email, text] of await build()) {
        const to = email.toLowerCase();
        if (to === actor || !ids.has(to)) continue;
        const r = await sendSlack(text, ids.get(to)!);
        if (!r.ok) console.error(`Slack DM to ${to} failed:`, r.error);
      }
    } catch (err) {
      console.error("Slack notify failed:", (err as Error).message);
    }
  });
}

async function draftInfo(id: string) {
  const [d] = (await sql`select title, created_by, scheduled_by_email from drafts where id = ${id}`) as { title: string; created_by: string; scheduled_by_email: string | null }[];
  return d ?? null;
}

type Thread = { id: string; author_name: string; author_email: string; body: string; quote: string | null; post_index: number | null; target: string | null; parent_id: string | null };

function whereLine(r: Pick<Thread, "quote" | "post_index" | "target">): string | null {
  if (r.quote) return `on “${esc(clip(r.quote, 140))}”${r.post_index != null ? ` (post ${r.post_index + 1})` : ""}`;
  if (r.target === "media") return `on the media${r.post_index != null ? ` (post ${r.post_index + 1})` : ""}`;
  if (r.target === "draft") return "on the whole draft";
  if (r.post_index != null) return `on post ${r.post_index + 1}`;
  return null;
}

/** A new comment or reply. */
export function notifyComment(u: Me, draftId: string, commentId: string) {
  deliver(u.email, async () => {
    const out = new Map<string, string>();
    const d = await draftInfo(draftId);
    const [c] = (await sql`select * from comments where id = ${commentId}`) as Thread[];
    if (!d || !c) return out;
    const rootId = c.parent_id ?? c.id;
    const thread = (await sql`select * from comments where id = ${rootId} or parent_id = ${rootId} order by created_at`) as Thread[];
    const root = thread.find((x) => String(x.id) === String(rootId)) ?? c;
    const reply = !!c.parent_id;
    const t = `*${esc(d.title)}*`;
    const msg = (head: string) => [head, whereLine(root), reply ? `_${esc(root.author_name)}:_ ${esc(clip(root.body.replace(/\s+/g, " ").trim(), 200))}` : null, quoted(c.body), link(draftId)].filter(Boolean).join("\n");
    for (const email of mentionedIn(c.body, await taggablePeople())) out.set(email, msg(`:wave: *${esc(u.name)} mentioned you* in ${reply ? "a reply" : "a comment"} on ${t}`));
    const set = (email: string, head: string) => !out.has(email.toLowerCase()) && out.set(email.toLowerCase(), msg(head));
    if (reply) for (const x of thread) set(x.author_email, `:speech_balloon: *${esc(u.name)} replied* to ${x.author_email === root.author_email ? "your comment" : "a comment thread you're in"} on ${t}`);
    set(d.created_by, `:speech_balloon: *${esc(u.name)} ${reply ? "replied to a comment" : "commented"}* on your draft ${t}`);
    return out;
  });
}

export function notifyResolved(u: Me, draftId: string, threadId: string) {
  deliver(u.email, async () => {
    const out = new Map<string, string>();
    const d = await draftInfo(draftId);
    const thread = (await sql`select * from comments where id = ${threadId} or parent_id = ${threadId} order by created_at`) as Thread[];
    const root = thread.find((x) => String(x.id) === String(threadId));
    if (!d || !root) return out;
    for (const x of thread)
      out.set(x.author_email.toLowerCase(), [`:ballot_box_with_check: *${esc(u.name)} resolved* ${x.author_email === root.author_email ? "your comment" : "a comment thread you're in"} on *${esc(d.title)}*`, whereLine(root), quoted(root.body, 200), link(draftId)].filter(Boolean).join("\n"));
    return out;
  });
}

export function notifySuggestion(u: Me, draftId: string, s: { post_index: number; base_text: string; proposed_text: string; note: string | null }) {
  deliver(u.email, async () => {
    const d = await draftInfo(draftId);
    if (!d) return new Map();
    const span = changedSpan(s.base_text, s.proposed_text);
    const lines = [`:pencil2: *${esc(u.name)} suggested an edit* on your draft *${esc(d.title)}* (post ${s.post_index + 1})`, "*Before*", quoted(span.before || "(empty)", 400), "*After*", quoted(span.after || "(removed)", 400)];
    if (s.note?.trim()) lines.push(`_Why:_ ${esc(clip(s.note.trim(), 300))}`);
    lines.push("Accept or reject it on the board.", link(draftId));
    return new Map([[d.created_by, lines.join("\n")]]);
  });
}

export function notifyDecided(u: Me, draftId: string, s: { author_email: string; post_index: number; base_text: string; proposed_text: string }, accepted: boolean) {
  deliver(u.email, async () => {
    const d = await draftInfo(draftId);
    if (!d) return new Map();
    const span = changedSpan(s.base_text, s.proposed_text);
    const head = accepted ? `:white_check_mark: *${esc(u.name)} accepted your suggested edit*` : `:heavy_minus_sign: *${esc(u.name)} declined your suggested edit*`;
    return new Map([[s.author_email, [`${head} on *${esc(d.title)}* (post ${s.post_index + 1})`, quoted(span.after || "(removed)", 400), link(draftId)].join("\n")]]);
  });
}

export function notifyVerdict(u: Me, draftId: string, verdict: Verdict, reason: string | null) {
  deliver(u.email, async () => {
    const d = await draftInfo(draftId);
    if (!d) return new Map();
    const t = `*${esc(d.title)}*`;
    const head = verdict === "approve" ? `:white_check_mark: *${esc(u.name)} approved* ${t}` : verdict === "kill" ? `:x: *${esc(u.name)} killed* ${t}` : `:warning: *${esc(u.name)} marked* ${t} *needs work*`;
    const text = [head, reason?.trim() ? quoted(reason) : null, verdict === "approve" ? "It's ready to post or schedule." : null, link(draftId)].filter(Boolean).join("\n");
    const out = new Map([[d.created_by, text]]);
    if (verdict === "approve") for (const a of ADMIN_EMAILS) out.set(a, text);
    return out;
  });
}

function renderNewDraft(who: string, d: Draft): string {
  const named = d.title && d.title !== UNTITLED;
  const lines = [`:memo: *${esc(who)} wrote a new draft*${named ? `: *${esc(d.title)}*` : ""} (${esc(folderOf(d.folder).label)}${d.label ? ` · ${esc(d.label)}` : ""})`];
  const first = d.posts[0]?.text?.trim();
  if (first) lines.push(quoted(first));
  const media = d.posts.flatMap((p) => p.media ?? []);
  const extras = [d.posts.length > 1 ? `${d.posts.length} posts in the thread` : "", media.length ? `${media.length} ${media.some((m) => m.type === "video") ? "media incl. video" : media.length > 1 ? "images" : "image"}` : ""].filter(Boolean);
  if (extras.length) lines.push(`_${extras.join(" · ")}_`);
  lines.push(link(d.id));
  return lines.join("\n");
}

/** Admins hear about a new draft once, the first time its writer steps away from it with words in it. The wait lets
 *  the editor's last save (sent together with this) land first. */
export function notifyNewDraft(u: Me, id: string) {
  deliver(u.email, async () => {
    await new Promise((r) => setTimeout(r, 2500));
    const d = await claimAnnouncement(id, u);
    return new Map(d ? ADMIN_EMAILS.map((a) => [a, renderNewDraft(u.name, d)] as [string, string]) : []);
  });
}

/** A post went live on X, or failed to. */
export function notifyPublished(id: string, r: { ok: boolean; url?: string; error?: string }) {
  deliver(null, async () => {
    const d = await draftInfo(id);
    if (!d) return new Map();
    const text = r.ok
      ? `:rocket: *${esc(d.title)}* is live on X: ${r.url}`
      : [`:rotating_light: *${esc(d.title)}* didn't post to X.`, quoted(r.error ?? "Unknown error", 300), "Fix it and retry from the draft.", link(id)].join("\n");
    return new Map([d.created_by, d.scheduled_by_email].filter((x): x is string => !!x).map((e) => [e, text] as [string, string]));
  });
}

/** Settings → "Send a test DM". */
export async function testSlack(u: Me) {
  const id = slackIds().get(u.email);
  if (!process.env.SLACK_BOT_TOKEN) return { ok: false, error: "SLACK_BOT_TOKEN is not set." };
  if (!id) return { ok: false, error: `${u.email} isn't in SLACK_USERS.` };
  return sendSlack(`:wave: Slack notifications from *${esc(APP_URL.replace(/^https?:\/\//, ""))}* are working. You'll hear about comments, suggested edits and approvals on drafts you're part of here.`, id);
}
