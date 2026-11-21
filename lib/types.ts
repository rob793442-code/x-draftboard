// Shared types (client + server).
import brand from "@/brand.config";

export type Folder = string;
export type Verdict = "approve" | "needs_work" | "kill";
export type ReviewStatus = "in_review" | "approved" | "needs_work" | "killed";
export type PublishState = "scheduled" | "publishing" | "posted" | "failed";

export interface Media {
  /** storage path, e.g. "uploads/2026-11-20/chart.png" */
  path: string;
  type: "image" | "video";
  alt?: string;
  /** where the browser (and the publisher) reads it: a Vercel Blob URL, or /api/media/... in local development */
  url?: string;
  /** videos: a JPG of the first frame */
  poster_url?: string;
}

export interface Post {
  text: string;
  media?: Media[];
  /** A quoted post (canonical https://x.com/<user>/status/<id>), attached with "Convert to quote". */
  quote?: string | null;
  /** A video shown from another post on X (X's share menu "Post video"): plays in the post, credited to its author.
   *  X's API can't make the native version, so publishing attaches it as a quote of that post. */
  video_post?: string | null;
}

/** A post on X as the quote card shows it (from /api/tweet). */
export interface Tweet {
  id: string;
  url: string;
  author: { name: string; username: string; avatar?: string; verified?: "business" | "government" | "blue" | null };
  created_at: string;
  /** display text: t.co links swapped for their display URLs, media/article links dropped */
  text: string;
  media?: { type: "photo" | "video" | "gif"; url: string; width?: number; height?: number; mp4?: string }[];
  article?: { title: string; preview?: string; cover?: string };
  fetched_at: string;
}

/** An X profile in the @handle directory. */
export interface XUser {
  username: string;
  name: string;
  avatar?: string;
  verified?: boolean;
  /** "business" (gold check), "government" (grey), "blue" */
  verified_type?: string;
  followers?: number;
  checked_at: string;
  /** where we know it from: lookup, drafts */
  sources?: string[];
}

/** The copy of a draft (the `data` column). Review state, authorship and publishing live in their own columns. */
export interface Draft {
  id: string;
  folder: Folder;
  title: string;
  label?: string;
  posts: Post[];
  created_at: string;
  updated_at: string;
  /** admin drag-and-drop position inside its folder (lower = higher up); null = not placed yet */
  order?: number | null;
}

export interface Publish {
  state: PublishState | null;
  scheduled_at: string | null;
  scheduled_by: string | null;
  error: string | null;
  posted_at: string | null;
  posted_url: string | null;
  /** how many posts of the thread are live (a failed thread resumes after these) */
  posted_count: number;
}

export interface Comment {
  id: string;
  draft_id: string;
  parent_id: string | null;
  post_index: number | null;
  target: "text" | "media" | "draft";
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  start_hint: number | null;
  body: string;
  author_name: string;
  author_email: string;
  resolved: boolean;
  resolved_by: string | null;
  created_at: string;
}

export interface Suggestion {
  id: string;
  draft_id: string;
  post_index: number;
  base_text: string;
  proposed_text: string;
  note: string | null;
  author_name: string;
  author_email: string;
  state: "pending" | "accepted" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface VerdictRow {
  id: number;
  draft_id: string;
  verdict: Verdict;
  reason: string | null;
  author_name: string;
  author_email: string;
  created_at: string;
}

export interface VersionRow {
  id: number;
  draft_id: string;
  data: Draft;
  author: string | null;
  note: string | null;
  created_at: string;
}

/** A draft in the board's lists. */
export type ListItem = Draft & {
  meta: {
    review_status: ReviewStatus;
    open_comments: number;
    pending_suggestions: number;
    created_by: string;
    created_by_name: string | null;
    /** approved, and the posts haven't changed since */
    approved_current: boolean;
    publish: Publish;
  };
};

/** Everything the draft view needs. */
export interface Bundle {
  draft: Draft;
  comments: Comment[];
  suggestions: Suggestion[];
  verdicts: VerdictRow[];
  review_status: ReviewStatus;
  created_by: string;
  created_by_name: string | null;
  approved_current: boolean;
  publish: Publish;
}

export interface Me {
  name: string;
  email: string;
  role: "admin" | "member";
  /** outside the company domains: an invited agency or freelancer */
  external: boolean;
  /** may post and schedule to X (brand.publishing.whoCanPublish) */
  can_publish: boolean;
}

/** The connected X account as the board shows it (no tokens). */
export interface XAccount {
  id: string;
  username: string;
  name: string;
  avatar?: string;
  verified_type?: "blue" | "business" | "government" | null;
  /** Premium accounts can post past 280 characters */
  long_posts?: boolean;
  connected_by?: string;
  connected_at?: string;
}

export const REVIEW_STATUSES: { key: ReviewStatus; label: string; badge: string }[] = [
  { key: "in_review", label: "Needs review", badge: "bg-accent/15 text-accent" },
  { key: "approved", label: "Approved", badge: "bg-emerald-400/15 text-emerald-300" },
  { key: "needs_work", label: "Needs work", badge: "bg-amber-400/15 text-amber-300" },
  { key: "killed", label: "Killed", badge: "bg-rose-400/15 text-rose-300" },
];
export const reviewMeta = (s: ReviewStatus) => REVIEW_STATUSES.find((x) => x.key === s) ?? REVIEW_STATUSES[0];

export const FOLDERS = brand.folders.length ? brand.folders : [{ key: "posts", label: "Posts", blurb: "" }];
export const folderOf = (key: string) => FOLDERS.find((f) => f.key === key) ?? { key, label: key, blurb: "" };
export const LABELS = brand.labels;

/** Title of a draft started with "New draft". */
export const UNTITLED = "Untitled draft";
/** A draft nobody has written anything in yet: no post text, media or quote, title untouched.
 *  The editor throws these away when its writer leaves them, so "New draft" never leaves empty cards behind. */
export const isBlankDraft = (d: Pick<Draft, "title" | "posts">) =>
  [UNTITLED, ""].includes(d.title.trim()) && d.posts.every((p) => !p.text.trim() && !p.media?.length && !p.quote && !p.video_post);

export const NO_PUBLISH: Publish = { state: null, scheduled_at: null, scheduled_by: null, error: null, posted_at: null, posted_url: null, posted_count: 0 };
