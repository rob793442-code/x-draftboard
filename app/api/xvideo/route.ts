// Plays a "Post video" clip from X inside the board. X's video server (video.twimg.com) answers 403 when a video
// player on any other site asks for the file (it checks the Referer), so the browser can't load the mp4 directly.
// This route fetches it server-side, without a Referer, and streams it back with Range support so seeking works.
// Only video.twimg.com files, and only for signed-in people (not an open relay).
import { currentUser, unauthorized } from "@/lib/user";

export const dynamic = "force-dynamic";

// Vercel caps a function's response near 4.5 MB, so each answer covers at most this many bytes. Browsers keep
// asking for the next range as the video plays, the same as with any server that sends partial content.
const CHUNK = 4 * 1024 * 1024;

const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

export async function GET(req: Request) {
  if (!(await currentUser())) return unauthorized();
  let src: URL;
  try {
    src = new URL(new URL(req.url).searchParams.get("u") ?? "");
  } catch {
    return new Response("bad video link", { status: 400 });
  }
  if (src.protocol !== "https:" || src.hostname !== "video.twimg.com") return new Response("not an X video", { status: 400 });

  // Open-ended or oversized ranges ("bytes=0-", what players send first) are trimmed to one chunk.
  const asked = req.headers.get("range");
  const m = /^bytes=(\d+)-(\d*)$/.exec(asked ?? "bytes=0-");
  let range = asked;
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), start + CHUNK - 1) : start + CHUNK - 1;
    range = `bytes=${start}-${end}`;
  }

  let up: Response;
  try {
    up = await fetch(src, { headers: range ? { Range: range } : {}, cache: "no-store", signal: req.signal });
  } catch (e) {
    return new Response(`couldn't reach X: ${(e as Error).message}`, { status: 502 });
  }
  if (!up.ok) return new Response(`X answered ${up.status}`, { status: up.status === 404 ? 404 : 502 });

  const headers = new Headers({ "cache-control": "private, max-age=3600", "accept-ranges": "bytes" });
  for (const h of PASS) {
    const v = up.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(up.body, { status: up.status, headers });
}
