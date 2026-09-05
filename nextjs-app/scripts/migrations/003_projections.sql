-- Read models (spec §8). Every table carries tenant_id and a row-level
-- security policy keyed on the transaction's tenant context (spec §9.5).
-- All are rebuildable from the event store (F17).

create table if not exists candidates (
  id                uuid primary key,
  tenant_id         uuid not null,
  email_hash        text not null,
  email_enc         jsonb,
  profile_enc       jsonb,
  key_id            text not null,
  locale            text not null default 'en',
  marketing_opt_out boolean not null default false,
  status            text not null default 'Active',
  created_at        timestamptz not null,
  updated_at        timestamptz not null,
  unique (tenant_id, email_hash)
);

create table if not exists process_summary (
  id                 uuid primary key,
  tenant_id          uuid not null,
  reference          text not null,
  slug               text not null,
  title              jsonb not null,
  status             text not null,
  hiring_manager_id  uuid,
  hr_advisor_id      uuid,
  location           text,
  classification     text,
  criteria           jsonb not null default '[]',
  plan               jsonb not null default '[]',
  rubrics            jsonb not null default '[]',
  stages             jsonb not null default '[]',
  board              jsonb not null default '[]',
  conflicts          jsonb not null default '[]',
  knockouts          jsonb not null default '[]',
  poster             jsonb not null default '{}',
  poster_version     integer not null default 0,
  publish_at         timestamptz,
  close_at           timestamptz,
  published_at       timestamptz,
  closed_at          timestamptz,
  completed_at       timestamptz,
  screening_open     boolean not null default false,
  approval           jsonb not null default '{}',
  version            integer not null default 0,
  created_at         timestamptz not null,
  updated_at         timestamptz not null,
  unique (tenant_id, reference),
  unique (tenant_id, slug)
);
create index if not exists process_summary_status on process_summary (tenant_id, status);

create table if not exists poster_public (
  process_id   uuid primary key,
  tenant_id    uuid not null,
  slug         text not null,
  version      integer not null,
  title        jsonb not null,
  body         jsonb not null,
  location     text,
  close_at     timestamptz,
  published_at timestamptz,
  amended_at   timestamptz,
  status       text not null check (status in ('scheduled', 'open', 'closed', 'cancelled')),
  unique (tenant_id, slug)
);

create table if not exists application_summary (
  id               uuid primary key,
  tenant_id        uuid not null,
  process_id       uuid not null,
  candidate_id     uuid not null,
  status           text not null,
  stage            text,
  stage_entered_at timestamptz,
  version          integer not null default 0,
  locale           text not null default 'en',
  source           jsonb,
  tags             jsonb not null default '[]',
  screening        jsonb,
  qualified        boolean,
  offer            jsonb,
  hired_at         timestamptz,
  withdrawn_at     timestamptz,
  submitted_at     timestamptz,
  email_bounced    boolean not null default false,
  stream_version   integer not null default 0,
  created_at       timestamptz not null,
  updated_at       timestamptz not null,
  unique (tenant_id, process_id, candidate_id)
);
create index if not exists application_summary_process on application_summary (tenant_id, process_id, stage);

create table if not exists audit_timeline (
  global_position bigint primary key,
  tenant_id       uuid not null,
  stream_id       text not null,
  stream_type     text not null,
  process_id      uuid,
  application_id  uuid,
  event_type      text not null,
  category        text not null,
  actor           jsonb not null,
  reason          text,
  causation_id    text,
  summary         jsonb not null default '{}',
  occurred_at     timestamptz not null
);
create index if not exists audit_timeline_process on audit_timeline (tenant_id, process_id, global_position);
create index if not exists audit_timeline_stream on audit_timeline (tenant_id, stream_id);

create table if not exists notification_queue (
  id                  uuid primary key,
  tenant_id           uuid not null,
  template_key        text not null,
  lang                text not null,
  recipient_kind      text not null,
  recipient_ref       text not null,
  address_enc         jsonb,
  key_id              text,
  subject_enc         jsonb,
  body_enc            jsonb,
  fallback            text,
  status              text not null default 'queued',
  attempts            integer not null default 0,
  last_error          text,
  provider_message_id text,
  causation_id        text,
  queued_at           timestamptz not null,
  sent_at             timestamptz,
  next_attempt_at     timestamptz
);
create index if not exists notification_queue_status on notification_queue (status, next_attempt_at);

create table if not exists notification_templates (
  tenant_id  uuid not null,
  key        text not null,
  lang       text not null,
  version    integer not null,
  subject    text not null,
  body       text not null,
  active     boolean not null default true,
  updated_at timestamptz not null,
  primary key (tenant_id, key, lang, version)
);

create table if not exists interview_slots (
  id             uuid primary key,
  tenant_id      uuid not null,
  process_id     uuid not null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  board          jsonb not null default '[]',
  status         text not null default 'open',
  application_id uuid,
  updated_at     timestamptz not null
);
create index if not exists interview_slots_process on interview_slots (tenant_id, process_id, starts_at);

create table if not exists documents (
  id             uuid primary key,
  tenant_id      uuid not null,
  application_id uuid not null,
  candidate_id   uuid not null,
  kind           text not null,
  filename_enc   jsonb,
  key_id         text not null,
  mime           text not null,
  size           integer not null,
  sha256         text not null,
  content        bytea,
  scan_status    text not null default 'PendingScan',
  removed        boolean not null default false,
  created_at     timestamptz not null
);
create index if not exists documents_application on documents (tenant_id, application_id);
create index if not exists documents_scan on documents (scan_status) where scan_status = 'PendingScan';

-- Self-declarations: separate key, separate policy; only aggregates leave it
create table if not exists ee_declarations (
  application_id uuid primary key,
  tenant_id      uuid not null,
  process_id     uuid not null,
  groups_enc     jsonb,
  key_id         text not null,
  withdrawn      boolean not null default false,
  updated_at     timestamptz not null
);

-- Accommodation requests: HR-only projection
create table if not exists accommodations (
  id                 uuid primary key,
  tenant_id          uuid not null,
  application_id     uuid not null,
  process_id         uuid not null,
  text_enc           jsonb,
  key_id             text not null,
  contact_preference text,
  stage              text,
  arrangement        jsonb,
  created_at         timestamptz not null,
  updated_at         timestamptz not null
);
create index if not exists accommodations_application on accommodations (tenant_id, application_id);

-- Tombstones left behind by crypto-shredding (F18)
create table if not exists shred_tombstones (
  subject_id  text primary key,
  tenant_id   uuid not null,
  kind        text not null,
  reason      text not null,
  shredded_at timestamptz not null
);

-- Row-level security as the second guard behind the data-access layer.
do $$
declare t text;
begin
  foreach t in array array[
    'candidates', 'process_summary', 'poster_public', 'application_summary', 'audit_timeline',
    'notification_queue', 'notification_templates', 'interview_slots', 'documents',
    'ee_declarations', 'accommodations', 'shred_tombstones'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$
      create policy tenant_isolation on %I
        using (
          current_setting('app.tenant_scope', true) = 'platform'
          or tenant_id::text = current_setting('app.tenant_id', true)
        )
        with check (
          current_setting('app.tenant_scope', true) = 'platform'
          or tenant_id::text = current_setting('app.tenant_id', true)
        )
    $p$, t);
  end loop;
end $$;
