#!/usr/bin/env node
// Fills a local board with a few sample drafts, so you can see how it works. Needs `npm run dev` running with
// DEV_USER set (it talks to the local API as that person). Usage: npm run demo [-- http://localhost:3000]
const base = (process.argv[2] ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function api(path, body, method = "POST") {
  const r = await fetch(`${base}/api${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("Not signed in. Start the dev server with DEV_USER set in .env.local.");
  if (!r.ok) throw new Error(`${path}: ${j.error ?? r.status}`);
  return j;
}


const samples = [
  {
    folder: "launches",
    title: "Launch: new dashboard",
    posts: [
      { text: "Our new dashboard is live.\n\nEverything you check every morning, on one screen: usage, spend and alerts, updated in real time." },
      { text: "Three things we heard from you and fixed:\n\n1. Load time is down from 4s to under 1s\n2. Filters stick between visits\n3. Export to CSV from any chart" },
      { text: "It's on for every account today. Tell us what you'd change: https://example.com/feedback" },
    ],
    comment: { body: "Can we lead with the load time? That's the part people asked for most.", quote: "Our new dashboard is live." },
    suggest: { post: 0, text: "Our new dashboard is live, and it loads in under a second.\n\nEverything you check every morning, on one screen: usage, spend and alerts, updated in real time." },
  },
  {
    folder: "posts",
    title: "Tip: keyboard shortcuts",
    posts: [{ text: "Small thing that saves an hour a week: press ? anywhere in the app to see every keyboard shortcut.\n\nOur favorite is G then D to jump to your dashboard." }],
    approve: true,
  },
  {
    folder: "ideas",
    title: "Customer story: how a 5-person team ships weekly",
    posts: [{ text: "How does a 5-person team ship every single week?\n\nWe asked one of our customers. Their answer was not what we expected." }],
  },
];

for (const s of samples) {
  const d = await api("/drafts", { folder: s.folder });
  await api(`/drafts/${d.id}`, { title: s.title, posts: s.posts }, "PATCH");
  if (s.comment) {
    const text = s.posts[0].text;
    const start = text.indexOf(s.comment.quote);
    await api(`/drafts/${d.id}/comments`, { post_index: 0, target: "text", quote: s.comment.quote, prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(start + s.comment.quote.length, start + s.comment.quote.length + 32), start_hint: start, body: s.comment.body });
  }
  if (s.suggest) await api(`/drafts/${d.id}/suggestions`, { post_index: s.suggest.post, base_text: s.posts[s.suggest.post].text, proposed_text: s.suggest.text, note: "Lead with the speed" });
  if (s.approve) await api(`/drafts/${d.id}/verdict`, { verdict: "approve", reason: "Good to go" });
  console.log(`+ ${s.title}`);
}
console.log(`\nOpen ${base} to see them.`);
