// Shared (client + server): what a teammate @tag looks like in a review comment.
export type Person = { email: string; name: string; tags: string[] };

/** "@ana" after a start, space or punctuation (not inside an email or URL). Group 2 is the tag. */
export const MENTION_RE = /(^|[^\w@/.])@([a-z0-9_]+)\b/gi;

/** Splits a comment body into plain text and tags of known people. */
export function splitMentions(body: string, people: Person[]): { text: string; person?: Person }[] {
  if (!people.length) return [{ text: body }];
  const out: { text: string; person?: Person }[] = [];
  let pos = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const p = people.find((x) => x.tags.includes(m[2].toLowerCase()));
    if (!p) continue;
    const at = (m.index ?? 0) + m[1].length;
    if (at > pos) out.push({ text: body.slice(pos, at) });
    out.push({ text: `@${m[2]}`, person: p });
    pos = at + 1 + m[2].length;
  }
  if (pos < body.length) out.push({ text: body.slice(pos) });
  return out;
}
