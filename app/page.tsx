import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Board from "@/components/Board";
import SignInCard from "@/components/SignInCard";
import brand from "@/brand.config";
import { getShared, shareUrl } from "@/lib/store";
import { folderOf, reviewMeta } from "@/lib/types";
import { currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Link previews for share links (?draft=<id>&s=<token>, from "Copy share link"). Slack, Discord and iMessage fetch
// the page without signing in and build the preview from these tags: the draft title, the first post's copy, and its
// first image (or a video's first frame). Without a valid token there are no draft tags.
export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const q = await searchParams;
  const shared = await getShared(one(q.draft), one(q.s)).catch(() => null);
  if (!shared) return {};
  const d = shared.draft;
  const media = d.posts.flatMap((p) => p.media ?? []);
  const m = media[0];
  const image = m ? (m.type === "image" ? m.url : m.poster_url) : undefined;
  const absolute = image && image.startsWith("/") ? undefined : image; // local dev files can't be fetched by Slack
  let description = (d.posts[0]?.text ?? "").trim();
  if (description.length > 1200) description = `${description.slice(0, 1199).trimEnd()}…`;
  const extras = [
    m?.type === "video" ? "▶ Video" : media.length > 1 ? `${media.length} images` : "",
    d.posts.length > 1 ? `+${d.posts.length - 1} more post${d.posts.length > 2 ? "s" : ""} in the thread` : "",
  ].filter(Boolean);
  if (extras.length) description += `\n\n${extras.join(" · ")}`;
  const title = d.title;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: "article",
      siteName: brand.name,
      url: shareUrl(d.id, one(q.s)),
      title,
      description,
      ...(absolute ? { images: [{ url: absolute, alt: m?.alt || title }] } : {}),
    },
    twitter: { card: absolute ? "summary_large_image" : "summary", title, description, ...(absolute ? { images: [absolute] } : {}) },
    other: {
      "twitter:label1": "Status",
      "twitter:data1": reviewMeta(shared.review_status).label,
      "twitter:label2": "Folder",
      "twitter:data2": folderOf(d.folder).label,
    },
  };
}

export default async function Page({ searchParams }: { searchParams: SP }) {
  if (!(await currentUser())) {
    const draft = one((await searchParams).draft);
    // A draft link shows the sign-in card in place (a 200, not a redirect) so link unfurlers read the preview tags
    // above; signing in lands on that draft.
    if (draft) return <SignInCard next={`/?draft=${encodeURIComponent(draft)}`} />;
    redirect("/signin");
  }
  return <Board />;
}
