// What posting through X's API costs (pay-per-use, late 2026: docs.x.com/x-api/getting-started/pricing). Prices
// change; the Developer Console (console.x.com) is the source of truth. Shared by the server and the board.
import type { Post } from "../types";
import { firstUrl, textFor } from "../xtext";

export const X_PRICES = {
  /** a post */
  post: 0.015,
  /** a post with a link in it (any link, including a quoted post's) */
  postWithUrl: 0.2,
  /** alt text on an image */
  mediaMetadata: 0.005,
  /** looking up an account (the editor's @handle check, the connected account's profile) */
  userRead: 0.01,
};

/** X bills a post at the higher rate when it contains a link; quotes and video posts go out as links. */
export const hasLink = (p: Post) => !!firstUrl(textFor(p));

export type Cost = { total: number; posts: number; withLink: number; alts: number };

/** What sending these posts through the API costs. */
export function apiCost(posts: Post[]): Cost {
  let total = 0;
  let withLink = 0;
  let alts = 0;
  for (const p of posts) {
    if (hasLink(p)) {
      withLink++;
      total += X_PRICES.postWithUrl;
    } else total += X_PRICES.post;
    const a = (p.media ?? []).slice(0, 4).filter((m) => m.alt?.trim()).length;
    alts += a;
    total += a * X_PRICES.mediaMetadata;
  }
  return { total, posts: posts.length, withLink, alts };
}

/** 1.5¢, 20¢, $1.23 */
export function usd(n: number): string {
  if (n < 1) {
    const c = Math.round(n * 1000) / 10;
    return `${Number.isInteger(c) ? c : c.toFixed(1)}¢`;
  }
  return `$${n.toFixed(2)}`;
}
