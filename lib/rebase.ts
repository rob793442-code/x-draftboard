// A suggestion stores the whole post before (base_text) and after (proposed_text). To show several on one
// post at once, and to accept them one after another, we work out the part each one changes and where that
// part sits in the post as it reads now. Used by the review view (inline tracked changes) and by accept.

/** A change placed in the current text: replace current.slice(start, end) with `insert`. */
export type Change = { start: number; end: number; insert: string };

const ws = (c: string | undefined) => c === undefined || /\s/.test(c);

/** The span of `base` a suggestion replaces, widened to whole words, and the text that replaces it. */
export function changeOf(base: string, proposed: string): { from: number; to: number; insert: string } | null {
  if (base === proposed) return null;
  let p = 0;
  while (p < base.length && p < proposed.length && base[p] === proposed[p]) p++;
  let s = 0;
  while (s < base.length - p && s < proposed.length - p && base[base.length - 1 - s] === proposed[proposed.length - 1 - s]) s++;
  let from = p;
  let to = base.length - s;
  // whole words, so the words we look for later don't start or end mid-word
  while (from > 0 && !ws(base[from - 1])) from--;
  while (to < base.length && !ws(base[to])) to++;
  if (from === to && base.length) {
    // a pure insertion between words: take in the word before it (or after it, at the very start)
    if (from > 0) {
      while (from > 0 && ws(base[from - 1])) from--;
      while (from > 0 && !ws(base[from - 1])) from--;
    } else {
      while (to < base.length && ws(base[to])) to++;
      while (to < base.length && !ws(base[to])) to++;
    }
  }
  return { from, to, insert: proposed.slice(from, to + proposed.length - base.length) };
}

/** Where a suggestion's change lands in `current`, or null when the words it changes are gone or ambiguous. */
export function rebase(base: string, proposed: string, current: string): Change | null {
  const c = changeOf(base, proposed);
  if (!c) return null;
  if (current === base) return { start: c.from, end: c.to, insert: c.insert };
  const old = base.slice(c.from, c.to);
  if (!old) return null;
  const pre = base.slice(Math.max(0, c.from - 40), c.from);
  const suf = base.slice(c.to, c.to + 40);
  let best = -1;
  let bestScore = -Infinity;
  let bestCtx = 0;
  let hits = 0;
  for (let i = current.indexOf(old); i !== -1; i = current.indexOf(old, i + 1)) {
    hits++;
    const j = i + old.length;
    let a = 0;
    while (a < pre.length && i - 1 - a >= 0 && current[i - 1 - a] === pre[pre.length - 1 - a]) a++;
    let b = 0;
    while (b < suf.length && j + b < current.length && current[j + b] === suf[b]) b++;
    // the start or end of the post counts as matching context when the suggestion was made there too
    const ctx = a + b + (c.from === 0 && i === 0 ? 20 : 0) + (c.to === base.length && j === current.length ? 20 : 0);
    const score = ctx - Math.abs(i - c.from) / 10000;
    if (score > bestScore) {
      best = i;
      bestScore = score;
      bestCtx = ctx;
    }
  }
  if (best < 0) return null;
  // words that show up more than once (or a tiny phrase) need some surrounding text to match to be sure
  if (bestCtx < 2 && (hits > 1 || old.trim().length < 4)) return null;
  return { start: best, end: best + old.length, insert: c.insert };
}

/** The post with the suggestion applied, or null when it can't be placed in the current text. */
export function applySuggestion(base: string, proposed: string, current: string): string | null {
  if (current === base) return proposed;
  const ch = rebase(base, proposed, current);
  return ch ? current.slice(0, ch.start) + ch.insert + current.slice(ch.end) : null;
}
