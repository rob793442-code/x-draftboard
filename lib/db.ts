// Postgres, server-only. Any Postgres works (Neon, Supabase, Railway, RDS, your own): set DATABASE_URL.
// In development with no DATABASE_URL, an embedded Postgres (PGlite) keeps the data in .data/pglite, so a fresh
// clone runs with `npm run dev` and nothing else.
//
//   const rows = await sql`select * from drafts where id = ${id}`;     // parameterized, returns rows
//   await tx([q`update ...`, q`insert ...`]);                         // several statements, all or nothing
//
// JS arrays become Postgres array literals, so cast them in SQL: `where id = any(${ids}::text[])`.
import { SCHEMA, SCHEMA_VERSION } from "./schema";

export type Row = Record<string, unknown>;
export type Query = { text: string; params: unknown[] };

const pgArray = (a: unknown[]) => `{${a.map((v) => (v === null || v === undefined ? "NULL" : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).join(",")}}`;

/** A parameterized query: q`select * from drafts where id = ${id}`. */
export function q(strings: TemplateStringsArray, ...values: unknown[]): Query {
  let text = strings[0];
  values.forEach((_, i) => (text += `$${i + 1}${strings[i + 1]}`));
  return { text, params: values.map((v) => (Array.isArray(v) ? pgArray(v) : v === undefined ? null : v)) };
}

interface Driver {
  run(x: Query): Promise<Row[]>;
  tx(xs: Query[]): Promise<void>;
  exec(script: string): Promise<void>;
}

async function connect(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    // prepare: false keeps it working behind transaction poolers (Neon's -pooler host, Supabase's port 6543).
    // The driver serializes a parameter by the type the server expects; queries here already pass JSON text for
    // json/jsonb (`${JSON.stringify(x)}::jsonb`), so that text goes through as-is instead of being encoded twice.
    const asJson = { serialize: (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)), parse: (x: string) => JSON.parse(x) };
    const pg = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX) || 5,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      onnotice: () => {},
      types: { json: { to: 114, from: [114], ...asJson }, jsonb: { to: 3802, from: [3802], ...asJson } },
    });
    return {
      run: (x) => pg.unsafe(x.text, x.params as never[]) as unknown as Promise<Row[]>,
      tx: async (xs) => {
        await pg.begin(async (t) => {
          for (const x of xs) await t.unsafe(x.text, x.params as never[]);
        });
      },
      exec: async (script) => {
        await pg.unsafe(script);
      },
    };
  }
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is not set. See .env.example.");
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir);
  return {
    run: async (x) => (await db.query<Row>(x.text, x.params)).rows,
    tx: async (xs) => {
      await db.transaction(async (t) => {
        for (const x of xs) await t.query(x.text, x.params);
      });
    },
    exec: async (script) => {
      await db.exec(script);
    },
  };
}

/** Creates or updates the tables when this deployment's schema is newer than the database's. */
async function migrate(d: Driver) {
  const [has] = await d.run(q`select to_regclass('public.app_state') is not null as ok`);
  if (has?.ok) {
    const [v] = await d.run(q`select value from app_state where key = 'schema_version'`);
    if (Number(v?.value) >= SCHEMA_VERSION) return;
  }
  await d.exec(SCHEMA);
  await d.run(q`insert into app_state (key, value) values ('schema_version', ${JSON.stringify(SCHEMA_VERSION)}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()`);
}

const g = globalThis as unknown as { __draftboardDb?: Promise<Driver> };

function driver(): Promise<Driver> {
  // One connection pool per server process (kept on globalThis so dev hot reloads don't open new ones).
  g.__draftboardDb ??= connect()
    .then(async (d) => (await migrate(d), d))
    .catch((e) => {
      g.__draftboardDb = undefined;
      throw e;
    });
  return g.__draftboardDb;
}

/** Runs one parameterized query and returns its rows. */
export async function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
  return (await driver()).run(q(strings, ...values));
}

/** Runs several queries in one transaction. */
export async function tx(queries: Query[]): Promise<void> {
  return (await driver()).tx(queries);
}

/** Small key/value settings (the connected X account, the scheduler's last run). */
export async function getState<T>(key: string): Promise<T | null> {
  const [r] = await sql`select value from app_state where key = ${key}`;
  return (r?.value as T) ?? null;
}

export async function setState(key: string, value: unknown) {
  await sql`insert into app_state (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

export async function deleteState(key: string) {
  await sql`delete from app_state where key = ${key}`;
}
