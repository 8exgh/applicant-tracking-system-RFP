-- Event store (spec §9.2). Append-only; nothing is ever deleted (invariant 11).
create table if not exists events (
  global_position bigserial primary key,
  tenant_id       uuid        not null,
  stream_id       text        not null,
  stream_version  integer     not null,
  event_type      text        not null,
  schema_version  integer     not null default 1,
  payload         jsonb       not null,   -- pii fields hold ciphertext envelopes {kid, iv, ct, tag}
  metadata        jsonb       not null,
  occurred_at     timestamptz not null default now(),
  unique (stream_id, stream_version)
);
create index if not exists events_tenant_stream on events (tenant_id, stream_id, stream_version);
create index if not exists events_type_position on events (event_type, global_position);

create table if not exists snapshots (
  stream_id      text primary key,
  stream_version integer not null,
  state          jsonb not null,
  taken_at       timestamptz not null
);

create table if not exists projection_checkpoints (
  projection      text primary key,
  global_position bigint not null,
  updated_at      timestamptz not null
);

-- Idempotency keys keep the original response for 7 days (spec §9.2, F27)
create table if not exists idempotency_keys (
  tenant_id  uuid not null,
  key        text not null,
  status     integer not null,
  response   jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

-- Per-candidate data keys wrapped by the master key (spec §9.6)
create table if not exists data_keys (
  key_id        text primary key,
  tenant_id     uuid not null,
  encrypted_dek text,                     -- null once destroyed
  status        text not null default 'active' check (status in ('active', 'destroyed')),
  created_at    timestamptz not null default now(),
  destroyed_at  timestamptz
);
create index if not exists data_keys_tenant on data_keys (tenant_id);

-- Access log for every PII read: identifiers only, no personal data (§9.11)
create table if not exists access_log (
  id          bigserial primary key,
  tenant_id   uuid,
  actor_type  text not null,
  actor_id    text,
  resource    text not null,
  subject_id  text,
  purpose     text not null,
  reason      text,
  occurred_at timestamptz not null default now()
);
create index if not exists access_log_tenant_time on access_log (tenant_id, occurred_at);

-- Security log: auth events, denials, rate limiting, tenant mismatches (§13)
create table if not exists security_log (
  id          bigserial primary key,
  tenant_id   uuid,
  kind        text not null,
  actor_id    text,
  resource    text,
  detail      jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index if not exists security_log_kind_time on security_log (kind, occurred_at);
