alter table candidates add column if not exists email_bounced boolean not null default false;
alter table candidates add column if not exists deletion_deferred_until timestamptz;
alter table candidates add column if not exists shredded_at timestamptz;
