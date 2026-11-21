"use client";
// The deployment's settings as the browser sees them (from /api/config), fetched once per page.

export type ClientConfig = {
  app_url: string;
  storage: "blob" | "local";
  x_configured: boolean;
  scheduler: { secret_set: boolean; last_run: { at: string; posted?: number; failed?: number } | null };
  slack: { token_set: boolean; people: number; you: boolean };
  access: { domains: string[]; email_signin: boolean };
  publishing: { method: "smart" | "api" | "manual"; spend: { month: number; budget: number | null } };
  dev_user: boolean;
};

let cached: Promise<ClientConfig> | null = null;

export function getConfig(fresh = false): Promise<ClientConfig> {
  if (!cached || fresh)
    cached = fetch("/api/config", { cache: "no-store" }).then((r) => {
      if (!r.ok) {
        cached = null;
        throw new Error("Couldn't load settings");
      }
      return r.json();
    });
  return cached;
}
