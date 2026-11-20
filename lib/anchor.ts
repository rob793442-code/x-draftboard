// Comments are pinned to a quoted phrase (plus a little context) so they survive edits elsewhere in the post.
export type Anchor = { quote: string; prefix: string; suffix: string; start: number };

export function makeAnchor(text: string, start: number, end: number): Anchor {
  return { quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32), start };
}

/** Where the quote is in the current text, or null if the phrase no longer exists. */
export function locate(text: string, a: { quote: string | null; prefix?: string | null; suffix?: string | null; start_hint?: number | null }): { start: number; end: number } | null {
  if (!a.quote) return null;
  const hits: number[] = [];
  for (let i = text.indexOf(a.quote); i !== -1; i = text.indexOf(a.quote, i + 1)) hits.push(i);
  if (!hits.length) return null;
  const score = (i: number) => {
    let s = 0;
    if (a.prefix && text.slice(Math.max(0, i - a.prefix.length), i) === a.prefix) s += 2;
    if (a.suffix && text.slice(i + a.quote!.length, i + a.quote!.length + a.suffix.length) === a.suffix) s += 2;
    s -= Math.abs(i - (a.start_hint ?? i)) / 10000;
    return s;
  };
  const best = hits.sort((x, y) => score(y) - score(x))[0];
  return { start: best, end: best + a.quote.length };
}
