-- Non-event-sourced system tables: the tenant directory, credentials,
-- sessions, magic links, rate limits. Contain no candidate content.

create table if not exists org_settings (
  tenant_id     uuid primary key,
  slug          text not null unique,
  name          text not null,
  time_zone     text not null,
  languages     jsonb not null default '[{"code":"en","required":true},{"code":"fr","required":true}]',
  settings      jsonb not null default '{}',
  branding      jsonb not null default '{}',
  feature_flags jsonb not null default '{}',
  status        text not null default 'Active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists platform_operators (
  id            uuid primary key,
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists users (
  id           uuid primary key,
  tenant_id    uuid not null,
  email        text not null,
  display_name text not null default '',
  roles        jsonb not null default '[]',
  language     text not null default 'en',
  status       text not null default 'Invited' check (status in ('Invited', 'Active', 'Deactivated')),
  invited_at   timestamptz,
  activated_at timestamptz,
  unique (tenant_id, email)
);

create table if not exists credentials (
  user_id           uuid primary key references users (id),
  password_hash     text,
  invite_token_hash text,
  invite_expires_at timestamptz,
  totp_secret       text,
  updated_at        timestamptz not null default now()
);

create table if not exists sessions (
  id           uuid primary key,
  tenant_id    uuid,
  subject_id   text not null,
  kind         text not null check (kind in ('staff', 'candidate', 'platform')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index if not exists sessions_subject on sessions (subject_id);

create table if not exists magic_links (
  id            uuid primary key,
  tenant_id     uuid not null,
  email_hash    text not null,
  token_hash    text not null unique,
  locale        text not null default 'en',
  purpose       text not null default 'sign_in',
  payload       jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  superseded_at timestamptz
);
create index if not exists magic_links_email on magic_links (tenant_id, email_hash);

create table if not exists rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null
);
