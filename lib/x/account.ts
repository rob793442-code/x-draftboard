// The one X account this board posts to: OAuth 2.0 (Authorization Code + PKCE) tokens, stored encrypted in
// app_state under "x_account", refreshed automatically. Server-only.
//
// X access tokens last about 2 hours; the refresh token (from the offline.access scope) is single-use, so every
// refresh stores the new pair. Two refreshes racing would burn the same refresh token, so the write is a
// compare-and-swap: the loser re-reads the row and uses the winner's token.
import { createHash, randomBytes } from "node:crypto";
import { getState, setState, deleteState, sql } from "../db";
import { X_CALLBACK_URL, X_CLIENT_ID, X_CLIENT_SECRET } from "../config";
import { open, seal } from "../crypto";
import { recordSpend } from "../spend";
import { X_PRICES } from "./pricing";
import type { XAccount } from "../types";

export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];
const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
/** X_API_URL points everything at a stand-in X for local testing; leave it unset. */
export const X_API = (process.env.X_API_URL ?? "https://api.x.com/2").replace(/\/$/, "");
const TOKEN_URL = `${X_API}/oauth2/token`;
const REVOKE_URL = `${X_API}/oauth2/revoke`;

type Stored = XAccount & { access: string; refresh: string | null; expires_at: string; scope: string };

export const xConfigured = () => !!(X_CLIENT_ID && X_CLIENT_SECRET);

const basic = () => `Basic ${Buffer.from(`${encodeURIComponent(X_CLIENT_ID)}:${encodeURIComponent(X_CLIENT_SECRET)}`).toString("base64")}`;

/** Step 1 of connecting: where to send the admin, plus the state and PKCE verifier to keep in a cookie until they return. */
export function startConnect() {
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = `${AUTHORIZE_URL}?${new URLSearchParams({
    response_type: "code",
    client_id: X_CLIENT_ID,
    redirect_uri: X_CALLBACK_URL,
    scope: X_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`;
  return { url, state, verifier };
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic() },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`X sign-in failed: ${j.error_description ?? j.error ?? r.status}`);
  return j;
}

type Me = { id: string; name: string; username: string; profile_image_url?: string; verified_type?: string; subscription_type?: string };

async function fetchMe(access: string): Promise<Me> {
  const r = await fetch(`${X_API}/users/me?user.fields=profile_image_url,verified_type,subscription_type`, { headers: { Authorization: `Bearer ${access}` }, cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { data?: Me; title?: string; detail?: string };
  if (!r.ok || !j.data) throw new Error(`Couldn't read the X account: ${j.detail ?? j.title ?? r.status}`);
  return j.data;
}

const publicPart = (s: Stored): XAccount => {
  const { access: _a, refresh: _r, expires_at: _e, scope: _s, ...pub } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
  return pub;
};

const profile = (me: Me): Pick<XAccount, "id" | "username" | "name" | "avatar" | "verified_type" | "long_posts"> => ({
  id: me.id,
  username: me.username,
  name: me.name,
  avatar: me.profile_image_url?.replace("_normal.", "_bigger."),
  verified_type: me.verified_type === "blue" || me.verified_type === "business" || me.verified_type === "government" ? me.verified_type : null,
  // Premium (any tier) can post past 280 characters. Unknown = assume not.
  long_posts: !!me.subscription_type && me.subscription_type.toLowerCase() !== "none",
});

/** Step 2: X sent the admin back with a code. Trade it for tokens, read who the account is, and store it all. */
export async function finishConnect(code: string, verifier: string, by: string): Promise<XAccount> {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: X_CALLBACK_URL, code_verifier: verifier, client_id: X_CLIENT_ID });
  const me = await fetchMe(t.access_token);
  await recordSpend("account_read", X_PRICES.userRead);
  const stored: Stored = {
    ...profile(me),
    connected_by: by,
    connected_at: new Date().toISOString(),
    access: seal(t.access_token),
    refresh: t.refresh_token ? seal(t.refresh_token) : null,
    expires_at: new Date(Date.now() + (t.expires_in ?? 7200) * 1000).toISOString(),
    scope: t.scope ?? X_SCOPES.join(" "),
  };
  await setState("x_account", stored);
  return publicPart(stored);
}

export async function getAccount(): Promise<XAccount | null> {
  const s = await getState<Stored>("x_account");
  return s ? publicPart(s) : null;
}

/** A valid access token for the connected account, refreshed if it's about to expire. */
export async function accessToken(): Promise<string> {
  const s = await getState<Stored>("x_account");
  if (!s) throw new Error("No X account is connected. An admin can connect one in Settings.");
  if (Date.parse(s.expires_at) - Date.now() > 120_000) return open(s.access);
  if (!s.refresh) throw new Error("The X connection expired and can't refresh itself. An admin needs to connect the account again in Settings.");
  let t: TokenResponse;
  try {
    t = await tokenRequest({ grant_type: "refresh_token", refresh_token: open(s.refresh), client_id: X_CLIENT_ID });
  } catch (e) {
    // Another request may have refreshed with this same token a moment ago: use what it stored.
    const now = await getState<Stored>("x_account");
    if (now && now.refresh !== s.refresh && Date.parse(now.expires_at) > Date.now()) return open(now.access);
    throw new Error(`${(e as Error).message}. An admin may need to connect the X account again in Settings.`);
  }
  const next: Stored = {
    ...s,
    access: seal(t.access_token),
    refresh: t.refresh_token ? seal(t.refresh_token) : s.refresh,
    expires_at: new Date(Date.now() + (t.expires_in ?? 7200) * 1000).toISOString(),
  };
  const won = await sql`update app_state set value = ${JSON.stringify(next)}::jsonb, updated_at = now()
    where key = 'x_account' and value->>'refresh' = ${s.refresh} returning key`;
  if (!won.length) {
    const now = await getState<Stored>("x_account");
    if (now) return open(now.access);
  }
  return t.access_token;
}

/** Re-reads the profile (name, avatar, check mark) after the account changes on X. */
export async function refreshProfile(): Promise<XAccount | null> {
  const s = await getState<Stored>("x_account");
  if (!s) return null;
  const me = await fetchMe(await accessToken());
  await recordSpend("account_read", X_PRICES.userRead);
  const cur = (await getState<Stored>("x_account")) ?? s;
  const next = { ...cur, ...profile(me) };
  await setState("x_account", next);
  return publicPart(next);
}

/** Disconnect: revoke the tokens at X (best effort) and forget them. */
export async function disconnect() {
  const s = await getState<Stored>("x_account");
  if (!s) return;
  for (const [token, hint] of [
    [s.refresh, "refresh_token"],
    [s.access, "access_token"],
  ] as const) {
    if (!token) continue;
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic() },
      body: new URLSearchParams({ token: open(token), token_type_hint: hint, client_id: X_CLIENT_ID }),
    }).catch(() => {});
  }
  await deleteState("x_account");
}
