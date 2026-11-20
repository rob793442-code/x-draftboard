// Encrypts the X account's tokens before they're stored (AES-256-GCM). The key is derived from AUTH_SECRET, which
// the site already needs for sign-in, so there's no extra secret to manage. Changing AUTH_SECRET means an admin has to
// connect the X account again (the old tokens can't be read anymore).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set (it also encrypts the X tokens).");
  return createHash("sha256").update(`draftboard:x-tokens:${secret}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function open(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}
