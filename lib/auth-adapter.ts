// The small Auth.js database adapter that email sign-in links need (one-time tokens, and a user record per email).
// Only used when email sign-in is set up; Google-only sign-in doesn't touch these tables. Server-only.
import { randomUUID } from "node:crypto";
import type { Adapter, AdapterAccount, AdapterUser, VerificationToken } from "next-auth/adapters";
import { sql, type Row } from "./db";

const user = (r: Row | undefined): AdapterUser | null =>
  r
    ? {
        id: r.id as string,
        email: r.email as string,
        name: (r.name as string) ?? null,
        image: (r.image as string) ?? null,
        emailVerified: r.email_verified ? new Date(r.email_verified as string) : null,
      }
    : null;

export function dbAdapter(): Adapter {
  return {
    async createUser(u: AdapterUser) {
      const id = randomUUID();
      const [r] = await sql`insert into auth_users (id, email, name, image, email_verified)
        values (${id}, ${u.email.toLowerCase()}, ${u.name ?? null}, ${u.image ?? null}, ${u.emailVerified ? u.emailVerified.toISOString() : null})
        on conflict (email) do update set name = coalesce(excluded.name, auth_users.name) returning *`;
      return user(r)!;
    },
    async getUser(id) {
      const [r] = await sql`select * from auth_users where id = ${id}`;
      return user(r);
    },
    async getUserByEmail(email) {
      const [r] = await sql`select * from auth_users where email = ${email.toLowerCase()}`;
      return user(r);
    },
    async getUserByAccount({ provider, providerAccountId }) {
      const [r] = await sql`select u.* from auth_users u join auth_accounts a on a.user_id = u.id
        where a.provider = ${provider} and a.provider_account_id = ${providerAccountId}`;
      return user(r);
    },
    async updateUser(u) {
      const [r] = await sql`update auth_users set
          name = coalesce(${u.name ?? null}, name), image = coalesce(${u.image ?? null}, image),
          email_verified = coalesce(${u.emailVerified ? u.emailVerified.toISOString() : null}, email_verified)
        where id = ${u.id} returning *`;
      return user(r)!;
    },
    async linkAccount(a: AdapterAccount) {
      await sql`insert into auth_accounts (provider, provider_account_id, user_id, type)
        values (${a.provider}, ${a.providerAccountId}, ${a.userId}, ${a.type}) on conflict do nothing`;
      return a;
    },
    async createVerificationToken(t: VerificationToken) {
      await sql`insert into auth_verification_tokens (identifier, token, expires) values (${t.identifier}, ${t.token}, ${t.expires.toISOString()})`;
      return t;
    },
    async useVerificationToken({ identifier, token }) {
      const [r] = await sql`delete from auth_verification_tokens where identifier = ${identifier} and token = ${token} returning *`;
      return r ? { identifier: r.identifier as string, token: r.token as string, expires: new Date(r.expires as string) } : null;
    },
  };
}
