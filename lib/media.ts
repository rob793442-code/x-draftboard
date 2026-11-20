// Where the browser loads a draft's media from: its Blob URL, or the local file through /api/media in development.
import type { Media } from "./types";

const enc = (rel: string) => `/api/media/${rel.split("/").map(encodeURIComponent).join("/")}`;
export const mediaUrl = (m: Media) => m.url ?? enc(m.path);
export const posterUrl = (m: Media) => m.poster_url ?? undefined;
