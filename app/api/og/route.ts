// Link-preview card data (og:title / og:image) for the X preview.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";
// Best-effort cache in the temp folder (Vercel functions can only write to /tmp; it lasts as long as the instance).
const CACHE = path.join(os.tmpdir(), "draftboard-og-cache.json");

type Card = { url: string; domain: string; title?: string; image?: string; via?: string; fetched_at: string };

function readCache(): Record<string, Card> {
  try { return JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { return {}; }
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const meta = (html: string, prop: string) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  const v = tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1] : undefined;
  return v === undefined ? undefined : decode(v);
};

export async function GET(req: Request) {
  if (!(await currentUser())) return unauthorized();
  const url = new URL(req.url).searchParams.get("url");
  if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ error: "url required" }, { status: 400 });
  const cache = readCache();
  if (cache[url]) return NextResponse.json(cache[url]);
  const domain = new URL(url).hostname.replace(/^www\./, "");
  let card: Card = { url, domain, fetched_at: new Date().toISOString() };
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (link preview)" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    const html = (await r.text()).slice(0, 300_000);
    const title = meta(html, "og:title") ?? meta(html, "twitter:title") ?? (decode(/<title>([^<]*)/i.exec(html)?.[1] ?? "") || undefined);
    const blocked = /just a moment|attention required|access denied|captcha/i.test(title ?? "");
    if (blocked) throw new Error("bot wall");
    let image = meta(html, "og:image") ?? meta(html, "twitter:image");
    if (image && image.startsWith("/")) image = new URL(image, url).toString();
    card = { ...card, title: title?.trim(), image };
  } catch {
    /* blocked or unreachable: try the fallback below */
  }
  // Sites behind a bot wall (e.g. Cloudflare) refuse direct fetches, the way X's own crawler isn't refused. Fall back
  // to Microlink's public link-preview API, which only receives the public URL. Free tier (~50 lookups/day).
  if (!card.image) {
    try {
      const r = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j.status === "success" && j.data) {
        card = { ...card, title: j.data.title ?? card.title, image: j.data.image?.url ?? undefined, via: "microlink" } as Card;
      }
    } catch {
      /* card stays domain-only */
    }
  }
  try {
    fs.writeFileSync(CACHE, JSON.stringify({ ...cache, [url]: card }, null, 2));
  } catch {
    /* cache is best-effort */
  }
  return NextResponse.json(card);
}
