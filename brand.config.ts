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
    /** A draft must be approved, and not edited since, before it can be posted or scheduled. */
    requireApproval: true,
    /** Who can post and schedule: "admins" (ADMIN_EMAILS) or "everyone" who can sign in. */
    whoCanPublish: "admins" as "admins" | "everyone",
  },
};

export default brand;
