# Make it look like yours

Everything brand-specific is in three places:

| File | What |
|---|---|
| `brand.config.ts` | Board name, company name, X handle and check mark (until the real account is connected), logo path, colors, folders, labels, publishing rules |
| `app/fonts.ts` | The UI font (any Google Font, or a local font file you're licensed to use) |
| `public/` | The logo (square, PNG or SVG; also used as the browser-tab icon and the placeholder avatar) |

## Colors

The board is dark, like X in dark mode, so the brand shows up as accents:

- `accent`: links, focus rings, active tabs, highlights. Pick something that reads on black (aim for a contrast
  ratio of 4.5:1 or more against `#000`).
- `primary`: solid buttons (Comment, Post now). Often the same as `accent`.
- `onPrimary`: text on those buttons (`#FFFFFF` or `#000000`, whichever is readable).

The X previews keep X's own colors (blue links, X's grays) so they look like the real thing.

## Folders and labels

`folders` are the sidebar's buckets, e.g. content pillars ("Education", "Product", "Community") or formats
("Threads", "Single posts", "Launches"). The `key` is stored with each draft: keep it short and don't change it once
drafts use it (rename the `label` freely). `labels` is an optional tag (a product line, a campaign); leave it empty to
hide it.

## Publishing rules

- `requireApproval: true` means a draft needs an approval, and no edits since, before it can post.
- `whoCanPublish: "admins"` or `"everyone"`.
