// Everything that makes this board yours lives here: name, colors, logo, folders, publishing rules.
// The setup skill (.claude/skills/setup) fills this in with you; you can also edit it by hand.
// Secrets never go in this file: they live in environment variables (see .env.example).

export type FolderDef = { key: string; label: string; blurb?: string };

export const brand = {
  /** The board's name: sidebar, browser tab, sign-in card, link previews. */
  name: "Draftboard",
  /** Your company, used in sign-in copy ("Sign in with your Acme Google account"). */
  company: "your company",

  /**
   * The X account the drafts are written for. Previews show this name and handle until an admin connects the real
   * account in Settings; after that, the connected account's name, avatar and check mark are used.
   */
  x: {
    name: "Your Company",
    handle: "yourcompany",
    /** Check mark in previews before the account is connected: null, "blue", "business" (gold) or "government" (grey). */
    verified: null as null | "blue" | "business" | "government",
  },

  /** Square logo for the sign-in card, the placeholder avatar and the browser tab. A file in /public. */
  logo: "/logo.svg",

  /**
   * Colors (hex). The board itself is dark, like X in dark mode, so pick an accent that reads on black.
   *   accent    links, focus rings, active filters, highlights
   *   primary   solid buttons (Save, Comment, Post now)
   *   onPrimary text on primary buttons
   */
  colors: {
    accent: "#1D9BF0",
    primary: "#1D9BF0",
    onPrimary: "#FFFFFF",
  },
  // The UI font is set in app/fonts.ts (next/font needs it written out there).

  /**
   * Folders drafts are filed in, top to bottom in the sidebar. `key` is what's stored with each draft, so keep it
   * short and don't change it once drafts use it (rename the label instead).
   */
  folders: [
    { key: "posts", label: "Posts", blurb: "Single posts and threads." },
    { key: "launches", label: "Launches", blurb: "Product news, releases and announcements." },
    { key: "ideas", label: "Ideas", blurb: "Rough takes worth shaping later." },
  ] as FolderDef[],

  /** Optional tag a draft can carry: a product, a campaign, a content pillar. Leave empty to hide it. */
  labels: [] as string[],

  publishing: {
    /**
     * How approved drafts get onto X (docs/x-api.md has the costs):
     *   "smart"   posts without links go through X's API (about 1.5¢ each); posts with a link (about 20¢ through the
     *             API) default to "Post it yourself", which is free. Recommended.
     *   "api"     everything goes through X's API: fully automatic posting and scheduling.
     *   "manual"  never use X's API: every post is posted (or scheduled) by hand on X. No X developer app needed.
     * Whichever you pick, people who can publish can still choose the other way on a single draft.
     */
    method: "smart" as "smart" | "api" | "manual",
    /** A draft must be approved, and not edited since, before it can be posted or scheduled. */
    requireApproval: true,
    /** Who can post and schedule: "admins" (ADMIN_EMAILS) or "everyone" who can sign in. */
    whoCanPublish: "admins" as "admins" | "everyone",
  },
};

export default brand;
