# 8Examples ATS — Applicant Tracking System

A bilingual (en-CA / fr-CA), accessible, Canadian-hosted applicant tracking system for
public-sector and public-interest employers, built as a **CQRS + Event Sourcing** system
in the same shape as `inventory-shopify` and `starter-sites` (Adam Dymitruk / Martin
Dilger event modelling): commands validate against replayed aggregate state and append
immutable events; projections build read models; automations run off todo-list queries
from a background processor.

The product and implementation specification, including the Gherkin features
(F01–F31) the tests are named after, lives in [`docs/spec.md`](docs/spec.md). The event
model (slices: command → events → read model → automation) is in
[`docs/event-model.md`](docs/event-model.md).

## Live deployment

| | |
|---|---|
| Public URL | https://ats.fusenv.com |
| Careers page | `https://ats.fusenv.com/en/<org-slug>/jobs` · `/fr/<org-slug>/emplois` |
| Staff app | https://ats.fusenv.com/staff |
| Platform operator | https://ats.fusenv.com/platform |
| Health | https://ats.fusenv.com/api/health |
| Host | Server16 (OVH), via its own Cloudflare tunnel |
| Deploy | push to `main` → GitHub Actions builds images → `repository_dispatch` `ats-deploy` → `devops/deploy-ats.yml` on the `server16` runner |

## Architecture

```
nextjs-app/              Next.js 16 app: UI + command/query API + event store + projections
  lib/domain/            Deciders: replay (evolve) + decide, pure and unit-tested in memory
  lib/commands/          Command handlers: load stream → decide → append (one transaction)
  lib/projections/       Projectors with checkpoints; rebuildable from the event store
  lib/reactors/          Process managers: events → notifications (inline, idempotent)
  lib/queries/           Read models with role-based redaction and access logging
  app/api/commands/[c]   POST /api/commands/<command>   (registry in lib/api/commands-registry.ts)
  app/api/queries/[q]    GET  /api/queries/<query>      (registry in lib/api/queries-registry.ts)
  scripts/migrations/    PostgreSQL schema (event store §9.2, projections §8, RLS §9.5)
background-processor/    Polls todo-list queries with an API key: projections catch-up,
                         schedulers (publish/close/expiry/reminders), upload scanning,
                         notification dispatch (log or SMTP provider)
docs/                    Specification and event model
http/                    IntelliJ / VS Code REST client samples
```

### Event store (PostgreSQL 16)

```sql
events(global_position, tenant_id, stream_id, stream_version, event_type, schema_version,
       payload jsonb, metadata jsonb, occurred_at)  unique (stream_id, stream_version)
```

Streams: `org-{tenantId}`, `process-{id}`, `application-{id}`, `candidate-{id}`,
`selfdeclaration-{applicationId}`, `accommodation-{applicationId}`, `notification-{id}`,
`template-{tenantId}-{key}`. Every event carries `eventId, tenantId, streamId, actor,
role, correlationId, causationId, reason, locale`. Append checks `expectedVersion`
(HTTP `If-Match` → 412 with the current version). Commands run under one global advisory
lock so projections apply in `global_position` order with no gaps; `Idempotency-Key`
replays the original response for 7 days.

### Personal information

Fields marked `(pii)` in the spec are encrypted with AES-256-GCM under a per-subject
data key (candidate, self-declaration and accommodation streams each have their own),
wrapped by `ATS_MASTER_KEY` (stands in for KMS). Deletion and disposition destroy the
key: history stays intact and verifiable, personal fields become unreadable, projection
rows are purged, a non-identifying tombstone remains. Every PII read is written to
`access_log`; auth events, denials and throttling go to `security_log`. Projection
tables carry row-level security keyed on the transaction's tenant context, and the app
connects as a non-superuser role so the policies actually apply.

## Run locally

```bash
# PostgreSQL (superuser for setup, plus a non-superuser app role)
docker run -d --name ats-pg -e POSTGRES_USER=ats -e POSTGRES_PASSWORD=ats -e POSTGRES_DB=ats -p 5439:5432 postgres:16-alpine
docker exec ats-pg psql -U ats -d ats -c "create role ats_app login password 'ats' nosuperuser nobypassrls; grant all on schema public to ats_app;"

cd nextjs-app && npm install && cp .env.example .env   # fill in the secrets
npm run migrate            # schema + platform operator from PLATFORM_OPERATOR_EMAIL/PASSWORD
npm run dev                # http://localhost:3000

cd ../background-processor && npm install && cp .env.example .env
npm run dev
```

First steps: sign in at `/platform`, create an organization (the response includes the
admin invitation link; it is also emailed when the processor's provider is `smtp`),
accept the invitation at `/staff/accept-invite`, then build a process from `/staff`.
Candidates start from the careers page and sign in with magic links (no passwords, no
CAPTCHA). With `EMAIL_PROVIDER=log` the processor prints message ids only; set
`ATS_EXPOSE_MAGIC_LINKS=1` in development to receive the magic link in the API response.

## Tests

```bash
cd nextjs-app
npm run test:domain        # 55 domain scenarios: given events → when command → then events
npm run test:application   # 32 application scenarios through the real route handlers against PostgreSQL
cd ../background-processor && npm test
```

The application scenarios run with a fake clock (`ATS_FAKE_CLOCK=1`) and the
notification queue as the fake provider. CI (`.github/workflows/build-and-deploy.yml`)
runs typecheck + both suites on a PostgreSQL service before building images.

## API

Commands: `POST /api/commands/<name>` with a JSON body validated by zod (unknown fields
→ 400 `validation_failed`). Errors are `{ error: <code>, message, details? }` using the
codes in the spec (`slug_taken`, `missing_language_content`, `closing_date_past`,
`rationale_required`, `consensus_required`, …). `GET /api/commands/x` lists commands.
Queries: `GET /api/queries/<name>?…`. Public: `GET /api/public/{org}/postings`,
`/postings/{slug}`, `/feed.json`, `/feed.xml`. Auth: staff bearer token from
`staff-login`; candidates an HttpOnly cookie from the magic-link landing
`/api/candidate/verify?token=`; the processor `X-API-Key`. `DELETE` on any resource is 405.

## Environment

`nextjs-app`: `DATABASE_URL`, `ATS_MASTER_KEY`, `JWT_SECRET`, `BACKGROUND_PROCESSOR_API_KEY`,
`PLATFORM_OPERATOR_EMAIL`, `PLATFORM_OPERATOR_PASSWORD`, `APP_BASE_URL`, `DEFAULT_ORG_SLUG`
(optional), `LOG_LEVEL`. `background-processor`: `NEXTJS_API_URL`, `NEXTJS_API_KEY`,
`EMAIL_PROVIDER` (`log` | `smtp`), `SMTP_*`, `EMAIL_FROM`, `POLLING_INTERVAL_MS`.

## Scope delivered and deferred

Delivered (v1 core): organizations and tenant isolation (F01), staff sessions with idle
and absolute limits, rate limiting, revocation (F02), magic links (F03), roles and
process scoping (F04), process lifecycle with approvals and optimistic concurrency (F05),
posting, scheduling, careers page, feeds, amendments, automatic close (F06), application
form with autosave, uploads with type/content checks and scanning, consent versions,
resubmission, knockouts, honeypot (F07), self-declaration and accommodation on separate
streams and keys with suppressed aggregates (F08), screening with batched results (F09),
pipeline stages with consensus gating and reasons (F10), independent scoring hidden until
submission, chair consensus, disagreement flags, exams with accommodation multipliers
(F11), interview slots, race-safe self-booking, reschedule cut-off, reminders (F12),
offers with separation of duties, typed-name acceptance, expiry (F15), bilingual
templates with placeholder vocabulary and optional-language fallback (F16), timeline,
staffing-file and candidate-record export, rebuildable projections, 405 on delete (F17),
candidate export, deferred deletion and crypto-shredding (F18), dashboard, funnel,
sources, EE aggregates, CSV with BOM (F20), settings, users, templates (F21), tenant
export (F23), i18n URLs and formats (F25), nonce CSP, headers, RLS, IDOR tests, input
validation (F26), health with projection lag (F28).

Deferred (documented, not built): OIDC and TOTP for staff (local accounts only),
reference checks (F13), talent pools (F14), retention automation and disposition
certificates (F19), scheduled reports, API tokens, webhooks and calendar adapters (F22),
axe/Playwright CI and third-party audit (F24 is met by markup conventions only),
white-label domains (F29), AI drafting (F30), GC extensions (F31), tagged PDF
generation, S3 documents (documents are stored in PostgreSQL) and ClamAV (a
signature/heuristic scanner with the same contract stands in).

## License

MIT
