// Teammates for Slack DMs and @tags in comments. Optional: without SLACK_BOT_TOKEN and SLACK_USERS it's all off.
//   SLACK_USERS   email → Slack member ID, comma-separated: "ana@acme.com=U01ABCDEF,ben@acme.com=U02GHIJKL"
// Only people listed there can be @tagged (a tag is a DM). Their names are the first names they use on the board;
// someone who hasn't done anything yet shows as their email's local part.
import { sql } from "./db";
import { MENTION_RE, type Person } from "./mention";

export function slackIds(raw = process.env.SLACK_USERS ?? ""): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of raw.split(",")) {
    const [email, id] = pair.split("=").map((s) => s.trim());
    if (email && id) m.set(email.toLowerCase(), id);
  }
  return m;
}

export const slackOn = () => !!process.env.SLACK_BOT_TOKEN && slackIds().size > 0;

export async function taggablePeople(): Promise<Person[]> {
  const ids = slackIds();
  if (!process.env.SLACK_BOT_TOKEN || !ids.size) return [];
  const emails = [...ids.keys()];
  const rows = (await sql`
    select distinct on (lower(email)) lower(email) as email, name from (
      select author_email as email, author_name as name, created_at from comments
      union all select author_email, author_name, created_at from suggestions
      union all select author_email, author_name, created_at from verdicts
      union all select created_by, created_by_name, created_at from drafts where created_by_name is not null
    ) a where lower(email) = any(${emails}::text[]) order by lower(email), created_at desc`) as { email: string; name: string }[];
  const names = new Map(rows.map((r) => [r.email, r.name]));
  const local = (e: string) => e.split("@")[0];
  const people = emails.map((email) => {
    const name = names.get(email)?.split(/\s+/)[0] || local(email).replace(/^./, (c) => c.toUpperCase());
    return { email, name, tags: [...new Set([name.toLowerCase().replace(/[^a-z0-9_]/g, ""), local(email).toLowerCase().replace(/[^a-z0-9_]/g, "")])].filter(Boolean) };
  });
  // two people with the same first name: only their email names tag them
  const seen = new Map<string, number>();
  for (const p of people) for (const t of p.tags) seen.set(t, (seen.get(t) ?? 0) + 1);
  return people.map((p) => ({ ...p, tags: p.tags.filter((t) => seen.get(t) === 1) })).filter((p) => p.tags.length);
}

/** Emails of the people a comment tags. */
export function mentionedIn(body: string, people: Person[]): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    const p = people.find((x) => x.tags.includes(m[2].toLowerCase()));
    if (p) out.add(p.email);
  }
  return [...out];
}
