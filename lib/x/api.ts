// Posting to X with the connected account's OAuth 2.0 token (API v2). Server-only.
//   createPost   POST /2/tweets (text, reply-to for threads, media)
//   uploadMedia  chunked upload: initialize → append (≤4 MB chunks) → finalize → wait for processing (video/GIF)
//   setAltText   POST /2/media/metadata
import { X_API } from "./account";
import type { MediaFile } from "../storage";

export class XError extends Error {
  constructor(
    message: string,
    public status: number,
    /** worth trying again later (rate limit, X having a moment) */
    public retryable: boolean,
  ) {
    super(message);
  }
}

async function call<T>(token: string, path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const r = await fetch(`${X_API}${path}`, {
    ...rest,
    headers: { Authorization: `Bearer ${token}`, ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const text = await r.text();
  let j: Record<string, unknown> = {};
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    /* not JSON */
  }
  if (!r.ok) {
    const errs = (j.errors as { message?: string; detail?: string }[] | undefined) ?? [];
    const why = (j.detail as string) ?? errs.map((e) => e.detail ?? e.message).filter(Boolean).join("; ") ?? (j.title as string);
    const reset = r.headers.get("x-rate-limit-reset");
    const hint = r.status === 429 && reset ? ` (rate limited until ${new Date(Number(reset) * 1000).toLocaleTimeString()})` : "";
    throw new XError(`X ${r.status}: ${why || text.slice(0, 200) || r.statusText}${hint}`, r.status, r.status === 429 || r.status >= 500);
  }
  return j as T;
}

/** Replies only work in your own threads on X's self-serve plans, which is all a thread here needs. */
export async function createPost(token: string, p: { text: string; replyTo?: string; mediaIds?: string[] }): Promise<string> {
  const body: Record<string, unknown> = {};
  if (p.text) body.text = p.text;
  if (p.replyTo) body.reply = { in_reply_to_tweet_id: p.replyTo };
  if (p.mediaIds?.length) body.media = { media_ids: p.mediaIds };
  const j = await call<{ data?: { id: string } }>(token, "/tweets", { method: "POST", json: body });
  if (!j.data?.id) throw new XError("X accepted the post but returned no id.", 200, false);
  return j.data.id;
}

const CHUNK = 4 * 1024 * 1024;

type MediaData = { id?: string; media_id_string?: string; processing_info?: { state: "pending" | "in_progress" | "succeeded" | "failed"; check_after_secs?: number; error?: { message?: string } } };
const idOf = (d?: MediaData) => d?.id ?? d?.media_id_string;

function categoryOf(contentType: string) {
  if (contentType === "image/gif") return "tweet_gif";
  if (contentType.startsWith("video/")) return "tweet_video";
  return "tweet_image";
}

/** Uploads one file to X and returns its media id once X has finished processing it. */
export async function uploadMedia(token: string, file: MediaFile): Promise<string> {
  const media_category = categoryOf(file.contentType);
  const init = await call<{ data?: MediaData }>(token, "/media/upload/initialize", {
    method: "POST",
    json: { media_type: file.contentType, total_bytes: file.size, media_category },
  });
  const id = idOf(init.data);
  if (!id) throw new XError("X didn't return a media id.", 200, false);

  for (let start = 0, seg = 0; start < file.size; start += CHUNK, seg++) {
    const chunk = await file.read(start, Math.min(start + CHUNK, file.size));
    const form = new FormData();
    form.append("segment_index", String(seg));
    form.append("media", new Blob([new Uint8Array(chunk)], { type: "application/octet-stream" }), "chunk");
    await call(token, `/media/upload/${id}/append`, { method: "POST", body: form });
  }

  let state = (await call<{ data?: MediaData }>(token, `/media/upload/${id}/finalize`, { method: "POST" })).data?.processing_info;
  // Images are ready at once; videos and GIFs are processed on X's side first.
  const until = Date.now() + 4 * 60_000;
  while (state && state.state !== "succeeded") {
    if (state.state === "failed") throw new XError(`X couldn't process this media: ${state.error?.message ?? "unknown error"}`, 400, false);
    if (Date.now() > until) throw new XError("X is still processing this video. It will be tried again.", 503, true);
    await new Promise((r) => setTimeout(r, Math.min(Math.max(state!.check_after_secs ?? 2, 1), 10) * 1000));
    state = (await call<{ data?: MediaData }>(token, `/media/upload?${new URLSearchParams({ command: "STATUS", media_id: id })}`)).data?.processing_info;
  }
  return id;
}

export async function setAltText(token: string, mediaId: string, alt: string) {
  await call(token, "/media/metadata", { method: "POST", json: { id: mediaId, metadata: { alt_text: { text: alt.slice(0, 1000) } } } });
}
