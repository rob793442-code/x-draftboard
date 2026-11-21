// The database schema. Applied automatically the first time the app talks to the database (lib/db.ts), and again
// whenever SCHEMA_VERSION goes up. Every statement must be safe to run twice.
export const SCHEMA_VERSION = 3;

export const SCHEMA = `
create table if not exists app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists drafts (
  id text primary key,
  folder text not null,
  title text not null,
  -- review status: in_review | approved | needs_work | killed
  status text not null default 'in_review',
  -- the copy: { id, folder, title, label?, posts: [{ text, media?, quote?, video_post? }], created_at, updated_at }
  data jsonb not null,
  -- an admin's drag-and-drop order inside the folder (null = not placed yet, shown on top newest first)
  position double precision,
  created_by text not null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  -- secret for share links that unfurl in Slack / Discord / iMessage
  share_token text unique,
  -- when the admins were told about this new draft (Slack), once per draft
  announced_at timestamptz,
  -- fingerprint of the posts when it was approved: editing after approval needs a new approval to publish
  approved_hash text,
  -- publishing to X: null | scheduled | publishing | posted | failed
  publish_state text,
  scheduled_at timestamptz,
  scheduled_by text,
  scheduled_by_email text,
  publish_error text,
  publish_attempts int not null default 0,
  publish_started_at timestamptz,
  -- ids of the posts made so far (a thread that fails halfway resumes from here)
  posted_ids jsonb,
  posted_at timestamptz,
  posted_url text
);
create index if not exists drafts_due on drafts(scheduled_at) where publish_state = 'scheduled';

create table if not exists versions (
  id serial primary key,
  draft_id text not null references drafts(id) on delete cascade,
  data jsonb not null,
  author text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists versions_draft on versions(draft_id);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  draft_id text not null references drafts(id) on delete cascade,
  parent_id uuid,
  post_index int,
  target text not null default 'text',
  quote text,
  prefix text,
  suffix text,
  start_hint int,
  body text not null,
  author_name text not null,
  author_email text not null,
  resolved boolean not null default false,
  resolved_by text,
  created_at timestamptz not null default now()
);
create index if not exists comments_draft on comments(draft_id);

create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  draft_id text not null references drafts(id) on delete cascade,
  post_index int not null,
  base_text text not null,
  proposed_text text not null,
  note text,
  author_name text not null,
  author_email text not null,
  state text not null default 'pending',
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists suggestions_draft on suggestions(draft_id);

create table if not exists verdicts (
  id serial primary key,
  draft_id text not null references drafts(id) on delete cascade,
  verdict text not null,
  reason text,
  author_name text not null,
  author_email text not null,
  created_at timestamptz not null default now()
);
create index if not exists verdicts_draft on verdicts(draft_id);

-- how a draft goes out: 'api' (posted by the board through X's API) or 'manual' (someone posts it on X by hand)
alter table drafts add column if not exists publish_method text;

-- what the board spent on X's API (estimated from X's price list), for the monthly total and budget in Settings
create table if not exists api_spend (
  id serial primary key,
  at timestamptz not null default now(),
  kind text not null,
  cost double precision not null,
  draft_id text
);
create index if not exists api_spend_at on api_spend(at);

-- who can get in beyond the company domains, and who's an admin. Everyone who signs in gets a row (last_seen);
-- invited = an admin added them (needed for emails outside ALLOWED_EMAIL_DOMAINS, e.g. an agency);
-- blocked = an admin removed them (they can't sign in, even on a company domain).
create table if not exists members (
  email text primary key,
  name text,
  role text not null default 'member',
  invited boolean not null default false,
  invited_by text,
  invited_at timestamptz,
  invite_token text unique,
  note text,
  blocked boolean not null default false,
  first_seen timestamptz,
  last_seen timestamptz
);

-- email sign-in links (Auth.js), only used when email sign-in is set up (AUTH_RESEND_KEY)
create table if not exists auth_users (
  id text primary key,
  email text unique,
  name text,
  image text,
  email_verified timestamptz
);
create table if not exists auth_accounts (
  provider text not null,
  provider_account_id text not null,
  user_id text not null references auth_users(id) on delete cascade,
  type text not null,
  primary key (provider, provider_account_id)
);
create table if not exists auth_verification_tokens (
  identifier text not null,
  token text not null,
  expires timestamptz not null,
  primary key (identifier, token)
);

-- the @handle directory behind the mention menu: profiles looked up on X (profile) or why a handle doesn't resolve (missing)
create table if not exists handles (
  username text primary key,
  profile jsonb,
  missing text,
  checked_at timestamptz not null default now()
);
`;
