// X text helpers: weighted character count (URLs count as 23) and the "Show more" cut.

const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi;

export function xLength(text: string): number {
  let n = 0;
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    n += countChars(text.slice(last, idx)) + 23;
    last = idx + m[0].length;
  }
  return n + countChars(text.slice(last));
}

function countChars(s: string): number {
  // X weights most CJK and emoji as 2; Latin as 1. Close enough for drafting.
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp > 0x10ff && !(cp >= 0x2000 && cp <= 0x206f) && !(cp >= 0x2010 && cp <= 0x201f) ? 2 : 1;
  }
  return n;
}

/** Where X's timeline cuts a long post with "Show more" (280 characters, at a word boundary). */
export const FOLD = 280;

export function foldIndex(text: string, limit = FOLD): number | null {
  if (text.length <= limit) return null;
  const cut = text.lastIndexOf(" ", limit);
  const nl = text.lastIndexOf("\n", limit);
  return Math.max(cut, nl, Math.floor(limit * 0.8));
}

export type Token = { kind: "text" | "url" | "mention" | "hashtag" | "cashtag"; value: string };

/** A $cashtag as X parses it: 1-6 letters, optionally a .X / _X class suffix ($BRK.B), not followed by a letter
 *  or digit. "$AAPL", "$BRK.B" and "($TSLA" parse; "$ABC1" (a digit) doesn't. */
const CASHTAG = String.raw`\$[A-Za-z]{1,6}(?:[._][A-Za-z]{1,2})?(?![A-Za-z0-9])`;

export function tokenize(text: string): Token[] {
  const re = new RegExp(
    String.raw`(@[A-Za-z0-9_]{1,15})|(#[A-Za-z][A-Za-z0-9_]*)|(${CASHTAG})|` +
      String.raw`((?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|org|io|xyz|net|co|ai|app|dev|finance|fi|gg|so|to|me|us|uk|eu|tech|link|info|ly|tv|gov|edu)(?:\/[^\s]*)?)`,
    "gi",
  );
  const out: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    // an @ inside an email is not a mention
    if (m[1] && idx > 0 && /[A-Za-z0-9._]/.test(text[idx - 1])) continue;
    // nor is a $ glued to a word (US$5, a$B); X does link one after punctuation, e.g. "($XRP"
    if (m[3] && idx > 0 && /[A-Za-z0-9_$]/.test(text[idx - 1])) continue;
    const kind = m[1] ? "mention" : m[2] ? "hashtag" : m[3] ? "cashtag" : "url";
    // like X, a sentence's closing punctuation is not part of the link
    const value = kind === "url" ? trimUrl(m[0]) : m[0];
    if (idx > last) out.push({ kind: "text", value: text.slice(last, idx) });
    out.push({ kind, value });
    last = idx + value.length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

function trimUrl(u: string): string {
  let v = u;
  while (/[.,;:!?'"’”)\]]$/.test(v)) {
    // keep a closing paren that belongs to the URL, e.g. en.wikipedia.org/wiki/Foo_(bar)
    if (v.endsWith(")") && (v.match(/\(/g)?.length ?? 0) >= (v.match(/\)/g)?.length ?? 0)) break;
    v = v.slice(0, -1);
  }
  return v;
}

/** Where a token links to: the URL itself, or the X page for a @mention / #hashtag / $cashtag. */
export function hrefFor(t: Token): string {
  if (t.kind === "mention") return `https://x.com/${t.value.slice(1)}`;
  if (t.kind === "hashtag") return `https://x.com/hashtag/${t.value.slice(1)}`;
  // X's own cashtag search; which asset or contract a $TICKER points to is picked on X when posting
  if (t.kind === "cashtag") return `https://x.com/search?q=${encodeURIComponent(t.value)}&src=cashtag_click`;
  return /^https?:\/\//i.test(t.value) ? t.value : `https://${t.value}`;
}

export function displayUrl(u: string): string {
  const s = u.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return s.length > 28 ? s.slice(0, 27) + "…" : s;
}

export function firstUrl(text: string): string | null {
  const t = tokenize(text).find((x) => x.kind === "url");
  return t ? hrefFor(t) : null;
}

const STATUS_RE = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15}|i\/web)\/status(?:es)?\/(\d{5,25})/i;

/** A link to a post on X: its id and the canonical https://x.com/<user>/status/<id>. */
export function parseTweetUrl(u: string): { id: string; url: string } | null {
  const m = STATUS_RE.exec(u.trim());
  if (!m) return null;
  return { id: m[2], url: `https://x.com/${m[1].toLowerCase() === "i/web" ? "i/web" : m[1]}/status/${m[2]}` };
}

/** The first link to a post on X in the text, with where it sits (so "Convert to quote" can take it out). */
export function tweetLinkIn(text: string): { id: string; url: string; start: number; end: number } | null {
  let pos = 0;
  for (const t of tokenize(text)) {
    const at = pos;
    pos += t.value.length;
    if (t.kind !== "url") continue;
    const tw = parseTweetUrl(t.value);
    if (tw) return { ...tw, start: at, end: pos };
  }
  return null;
}

/** The text with [start, end) taken out, tidying the spaces/blank lines the link leaves behind. */
export function cutRange(text: string, start: number, end: number): string {
  const before = text.slice(0, start).replace(/[ \t]+$/, "");
  const after = text.slice(end).replace(/^[ \t]+/, "");
  if (!after.trim()) return before.trimEnd();
  if (!before.trim()) return after.trimStart();
  const joined = /\n$/.test(before) || /^\n/.test(after) ? before + after : `${before} ${after}`;
  return joined.replace(/\n{3,}/g, "\n\n");
}

/** How X dates a post in a quote card: "12m" / "5h" today, "Oct 28" this year, "Oct 28, 2025" before. */
export function xDate(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = new Date(t);
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}
