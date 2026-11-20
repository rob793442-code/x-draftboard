// A post on X, shaped for the quote card. Read from X's public embed endpoint (cdn.syndication.twimg.com, the
// one embedded tweets use): no API key and no cost. Only the post id is sent.
// Cached for a day; a stale copy is served if X fails.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { currentUser, unauthorized } from "@/lib/user";
import { parseTweetUrl } from "@/lib/xtext";
import type { Tweet } from "@/lib/types";

export const dynamic = "force-dynamic";
// Best-effort cache in the temp folder (Vercel functions can only write to /tmp; it lasts as long as the instance).
const CACHE = path.join(os.tmpdir(), "draftboard-tweet-cache.json");
const FRESH_MS = 24 * 3600 * 1000;

function readCache(): Record<string, Tweet> {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } catch {
    return {};
  }
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");

type Ent = { indices: [number, number]; display_url?: string; expanded_url?: string };
type Synd = {
  __typename?: string;
  id_str: string;
  text: string;
  created_at: string;
  display_text_range?: [number, number];
  entities?: { urls?: Ent[]; media?: Ent[] };
  user: { name: string; screen_name: string; profile_image_url_https?: string; is_blue_verified?: boolean; verified_type?: string };
  mediaDetails?: { type: string; media_url_https: string; original_info?: { width?: number; height?: number }; video_info?: { variants?: { bitrate?: number; content_type?: string; url: string }[] } }[];
  article?: { title?: string; preview_text?: string; cover_media?: { media_info?: { original_img_url?: string } } };
};

/** The text X shows: inside display_text_range (drops leading reply @s and the trailing pic link), t.co links
 *  swapped for their display URL, an article's own link dropped. Indices count code points, like X's. */
function displayText(j: Synd): string {
  const chars = Array.from(j.text ?? "");
  const [a, b] = j.display_text_range ?? [0, chars.length];
  const urls = (j.entities?.urls ?? []).filter((u) => u.indices[0] >= a && u.indices[1] <= b).sort((x, y) => x.indices[0] - y.indices[0]);
  let out = "";
  let at = a;
  for (const u of urls) {
    out += chars.slice(at, u.indices[0]).join("");
    if (!(j.article && /x\.com\/i\/article\//.test(u.expanded_url ?? ""))) out += u.display_url ?? "";
    at = u.indices[1];
  }
  out += chars.slice(at, b).join("");
  return decode(out).trim();
}

/** The mp4 we play in previews: the best one up to 720p-ish bitrate (the 1080p+ files are huge). */
function bestMp4(v?: { bitrate?: number; content_type?: string; url: string }[]): string | undefined {
  const mp4 = (v ?? []).filter((x) => x.content_type === "video/mp4").sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
  return (mp4.filter((x) => (x.bitrate ?? 0) <= 2_200_000).pop() ?? mp4[0])?.url;
}

function shape(j: Synd, url: string): Tweet {
  const vt = j.user.verified_type?.toLowerCase();
  const art = j.article;
  return {
    id: j.id_str,
    url,
    author: {
      name: j.user.name,
      username: j.user.screen_name,
      avatar: j.user.profile_image_url_https?.replace("_normal.", "_bigger."),
      verified: vt === "business" || vt === "government" ? vt : j.user.is_blue_verified ? "blue" : null,
    },
    created_at: j.created_at,
    text: displayText(j),
    media: (j.mediaDetails ?? []).map((m) => ({
      type: m.type === "video" ? "video" : m.type === "animated_gif" ? "gif" : "photo",
      url: m.media_url_https,
      width: m.original_info?.width,
      height: m.original_info?.height,
      mp4: bestMp4(m.video_info?.variants),
    })),
    article: art?.title ? { title: art.title, preview: art.preview_text, cover: art.cover_media?.media_info?.original_img_url } : undefined,
    fetched_at: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  if (!(await currentUser())) return unauthorized();
  const tw = parseTweetUrl(new URL(req.url).searchParams.get("url") ?? "");
  if (!tw) return NextResponse.json({ error: "not a link to a post on X" }, { status: 400 });
  const cache = readCache();
  const hit = cache[tw.id];
  const oldVideo = hit?.media?.some((m) => m.type === "video" && !m.mp4); // cached before video files were kept
  if (hit && !oldVideo && Date.now() - Date.parse(hit.fetched_at) < FRESH_MS) return NextResponse.json({ ...hit, url: tw.url });

  // The token X's embed script sends with each lookup, derived from the id.
  const token = ((Number(tw.id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  try {
    const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${tw.id}&lang=en&token=${token}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const j = r.ok ? ((await r.json().catch(() => null)) as Synd | null) : null;
    if (!j || !j.user || j.__typename === "TweetTombstone") {
      if (hit) return NextResponse.json({ ...hit, url: tw.url });
      return NextResponse.json({ error: "This post is unavailable (deleted, private or age-restricted)." }, { status: 404 });
    }
    const t = shape(j, tw.url);
    try {
      fs.writeFileSync(CACHE, JSON.stringify({ ...readCache(), [tw.id]: t }, null, 1));
    } catch {
      /* cache is best-effort */
    }
    return NextResponse.json(t);
  } catch (e) {
    if (hit) return NextResponse.json({ ...hit, url: tw.url });
    return NextResponse.json({ error: `Couldn't reach X: ${(e as Error).message}` }, { status: 502 });
  }
}
