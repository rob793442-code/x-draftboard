"use client";
// Settings: the connected X account, the scheduler, Slack, and who can sign in. Most of it is set with environment
// variables (docs/), so this page shows what's set and checks it works; connecting X happens here.
import { useEffect, useState } from "react";
import brand from "@/brand.config";
import type { Me, XAccount } from "@/lib/types";
import { getConfig, type ClientConfig } from "./config";
import { Badge, reloadAccount } from "./XPost";
import People from "./People";

const card = "flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5";
const eyebrow = "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-white/40";
const ghost = "rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:border-accent hover:text-accent disabled:opacity-40";
const solid = "inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-110";
const ok = (on: boolean) => (on ? "text-emerald-300" : "text-amber-300");

const X_MESSAGES: Record<string, string> = {
  connected: "Connected. Drafts can now be posted and scheduled to this account.",
  cancelled: "Connecting was cancelled on X.",
  expired: "That sign-in took too long or came from another browser. Try again.",
  failed: "X didn't accept the connection.",
  "admins-only": "Only admins can connect the X account.",
  "not-configured": "Add X_CLIENT_ID and X_CLIENT_SECRET first (see below).",
};

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ml-1 text-[11px] text-accent hover:underline"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => window.prompt("Copy:", text));
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

export default function Settings({ me }: { me: Me }) {
  const [cfg, setCfg] = useState<ClientConfig | null>(null);
  const [x, setX] = useState<{ account: XAccount | null; configured: boolean; callback_url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [slackMsg, setSlackMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ x: string; detail: string | null } | null>(null);

  useEffect(() => {
    getConfig(true).then(setCfg).catch(() => {});
    fetch("/api/x/account").then(async (r) => r.ok && setX(await r.json()));
    const q = new URLSearchParams(window.location.search);
    if (q.get("x")) setNotice({ x: q.get("x")!, detail: q.get("detail") });
    if (q.get("x") === "connected") reloadAccount();
  }, []);

  const xCall = async (method: "POST" | "DELETE") => {
    if (method === "DELETE" && !confirm("Disconnect the X account? Scheduled drafts won't post until an account is connected again.")) return;
    setBusy(method);
    const r = await fetch("/api/x/account", { method });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return alert(j.error ?? "That didn't work");
    setX(j);
    reloadAccount();
  };

  const testSlack = async () => {
    setSlackMsg("Sending…");
    const r = await fetch("/api/settings/slack-test", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setSlackMsg(r.ok ? "Sent. Check your Slack DMs." : `Didn't send: ${j.error ?? r.statusText}`);
  };

  const a = x?.account;
  const last = cfg?.scheduler.last_run?.at;
  const stale = !last || Date.now() - Date.parse(last) > 2 * 3600_000;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <div className={eyebrow}>Settings</div>
        <h1 className="text-2xl font-medium tracking-[-0.02em]">{brand.name}</h1>
        <div className="text-sm text-white/45">Branding, folders and posting rules live in brand.config.ts; keys and secrets in your host&apos;s environment variables.</div>
      </div>

      {cfg?.dev_user && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-xs text-amber-200">
          Local development: you&apos;re signed in as {me.email} through DEV_USER, without Google. Production ignores DEV_USER.
        </div>
      )}

      <section className={card}>
        <div className={eyebrow}>X account</div>
        {notice && (
          <div className={`rounded-lg px-3 py-2 text-xs ${notice.x === "connected" ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"}`}>
            {X_MESSAGES[notice.x] ?? notice.x}
            {notice.detail ? ` ${notice.detail}` : ""}
          </div>
        )}
        {a ? (
          <div className="flex flex-wrap items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {a.avatar && <img src={a.avatar} alt="" className="h-11 w-11 rounded-full" />}
            <div className="min-w-0">
              <div className="flex items-center gap-1 font-medium">
                {a.name} {a.verified_type && <Badge kind={a.verified_type} />}
              </div>
              <div className="text-sm text-white/50">
                @{a.username} · {a.long_posts ? "can post long posts" : "280 characters per post"}
                {a.connected_by ? ` · connected by ${a.connected_by}` : ""}
              </div>
            </div>
            <span className="flex-1" />
            {me.role === "admin" && (
              <>
                <button type="button" className={ghost} disabled={!!busy} onClick={() => xCall("POST")} title="Re-read the name, avatar and check mark from X">
                  Refresh profile
                </button>
                <a className={ghost} href="/api/x/connect" title="Connect again (or switch to another account)">
                  Reconnect
                </a>
                <button type="button" className={`${ghost} hover:!border-rose-400/60 hover:!text-rose-300`} disabled={!!busy} onClick={() => xCall("DELETE")}>
                  Disconnect
                </button>
              </>
            )}
          </div>
        ) : x?.configured ? (
          me.role === "admin" ? (
            <div className="flex flex-wrap items-center gap-3">
              <a className={solid} href="/api/x/connect">
                Connect X account
              </a>
              <span className="text-xs text-white/45">Sign in to X as the company account (not your personal one) and approve the app.</span>
            </div>
          ) : (
            <div className="text-sm text-white/55">No account connected yet. An admin can connect one here.</div>
          )
        ) : (
          <div className="flex flex-col gap-2 text-sm text-white/60">
            <div>To post from here, create an app at developer.x.com and add its OAuth 2.0 keys as X_CLIENT_ID and X_CLIENT_SECRET.</div>
            {x && (
              <div className="text-xs text-white/45">
                Callback URL for the app: <code className="rounded bg-white/10 px-1.5 py-0.5 text-white/80">{x.callback_url}</code>
                <Copy text={x.callback_url} />
              </div>
            )}
            <div className="text-xs text-white/40">Step by step: docs/x-api.md in the repo.</div>
          </div>
        )}
      </section>

      <section className={card}>
        <div className={eyebrow}>Scheduler</div>
        {cfg && (
          <>
            <div className="text-sm text-white/70">
              Scheduled drafts post when the scheduler runs, and within a minute or so whenever someone has the board open.
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <span className={ok(cfg.scheduler.secret_set)}>{cfg.scheduler.secret_set ? "✓ CRON_SECRET is set" : "CRON_SECRET isn't set, so the scheduler can't run. Add one (any long random string)."}</span>
              <span className={ok(!stale)}>
                {last ? `Last run ${new Date(last).toLocaleString()}` : "The scheduler hasn't run yet."}
                {cfg.scheduler.last_run?.posted ? ` · posted ${cfg.scheduler.last_run.posted}` : ""}
                {stale && cfg.scheduler.secret_set ? " · if this stays empty, check docs/scheduling.md" : ""}
              </span>
            </div>
          </>
        )}
      </section>

      <section className={card}>
        <div className={eyebrow}>Slack notifications</div>
        {cfg && (
          <>
            <div className="text-sm text-white/70">Optional. People get a DM when someone comments on, edits, approves or posts a draft they&apos;re part of, and can be @tagged in comments.</div>
            <div className="flex flex-col gap-1 text-xs">
              <span className={ok(cfg.slack.token_set)}>{cfg.slack.token_set ? "✓ SLACK_BOT_TOKEN is set" : "Off: SLACK_BOT_TOKEN isn't set (docs/slack.md)."}</span>
              {cfg.slack.token_set && (
                <span className={ok(cfg.slack.you)}>
                  {cfg.slack.people} {cfg.slack.people === 1 ? "person" : "people"} in SLACK_USERS{cfg.slack.you ? ", including you" : `, not including ${me.email}`}
                </span>
              )}
            </div>
            {cfg.slack.token_set && cfg.slack.you && (
              <div className="flex items-center gap-2">
                <button type="button" className={ghost} onClick={testSlack}>
                  Send me a test DM
                </button>
                {slackMsg && <span className="text-xs text-white/55">{slackMsg}</span>}
              </div>
            )}
          </>
        )}
      </section>

      <section className={card}>
        <div className={eyebrow}>People</div>
        {cfg && me.role === "admin" ? (
          <People me={me} domains={cfg.access.domains} emailSignin={cfg.access.email_signin} />
        ) : (
          <div className="text-sm text-white/55">
            {cfg?.access.domains.length ? `Anyone with a ${cfg.access.domains.map((d) => `@${d}`).join(", ")} account can sign in. ` : ""}
            Admins can invite people from outside the company, like an agency.
          </div>
        )}
        <div className="pt-1 text-xs text-white/40">
          {brand.publishing.whoCanPublish === "everyone" ? "Everyone who can sign in can post and schedule." : "Only admins post and schedule."}{" "}
          {brand.publishing.requireApproval ? "Drafts need an approval before they can go out." : "Drafts can go out without an approval."}
        </div>
        {cfg && (
          <div className={`text-xs ${cfg.storage === "local" ? "text-amber-300" : "text-white/40"}`}>
            {cfg.storage === "local" ? "Media is saved on this computer (.data/uploads). Add a Vercel Blob store before you deploy." : "Media is stored in Vercel Blob."}
          </div>
        )}
      </section>
    </div>
  );
}
