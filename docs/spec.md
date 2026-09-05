# 8Examples ATS — Product and Implementation Specification

**Version:** 0.1 (draft for implementation) · **Date:** 2026-09-05 · **Owner:** Sean, 8Examples Inc. · **Repo:** `8exgh/applicant-tracking-system-RFP`

> Implementation status against this document is summarised in the README ("Scope delivered and deferred"). Test files are named after the feature IDs below (`tests/domain/*.test.ts`, `tests/application/flow.test.ts`).

## 0. How to read this document

Part A (§1–§18) says what the product is, who it is for, how it is shaped and what it must guarantee. Part B (features F01–F31) says how it behaves, as Gherkin scenarios that are meant to become automated tests, not prose.

Tags used in Part B:

- `@v1` design-partner release (first two clients) · `@v1.1` white-label, pools, references, integrations · `@v2` Government of Canada staffing
- `@a11y` `@security` `@privacy` `@audit` `@perf` `@ops` `@i18n` `@gc` cross-cutting concerns

Scenario layers (§16): **domain** scenarios run against aggregates in memory (given events → when command → then events); **application** scenarios run through the API against a real PostgreSQL; **UI** scenarios run in Playwright; **infrastructure** scenarios run against a deployed environment. The layer is inferred from the step vocabulary in §16.

Anything in `[brackets]` is an open decision (§18). Nothing here is legal advice: retention periods, the privacy notice and the client agreement need a lawyer before the first client goes live.

---

## 1. Product thesis

A bilingual, accessible, Canadian-hosted applicant tracking system for Canadian public-sector and public-interest employers — municipalities, non-profits, school boards, health organizations, crown corporations and, in v2, federal departments hiring under the Public Service Employment Act. Its differentiators are the things the large US vendors treat as add-ons: English/French parity enforced by the system, WCAG 2.1 AA as a release gate, data that never leaves Canada, and an event-sourced staffing file that gives every process a complete, tamper-evident history for audits, complaints and access-to-information requests.

The first release exists to get two or three named organizations running real hiring on it, so that future RFP mandatories ("commercially available, in production, with references") can be answered truthfully.

## 2. Target customers and release phases

| Phase | Customer | Scope headline | Exit criterion |
|---|---|---|---|
| v1 | 2 design partners: a Canadian non-profit and a small municipality (≤ 50 hires/year each) | Process → poster → careers page → application → screening → assessment → interviews → offer; staffing file; notifications; privacy rights; reporting | Both partners run ≥ 1 full process end-to-end; third-party accessibility audit passed; security review complete |
| v1.1 | 5–10 paying organizations | White-label domains and senders, talent pools, reference checks, retention automation, API/webhooks, calendar integration | Self-serve onboarding; monthly service report |
| v2 | Federal departments and agencies | PSEA staffing structure (SoMC, area of selection, priority entitlements, SLE, security status, notifications of consideration/appointment), GC Notify, GC Sign-In, PSRS interchange, SA&A evidence package | One GC tenant in production; ATO obtained |
| v3 | Larger institutions | SCIM provisioning, SSO federation for multiple IdPs, advanced analytics, e-signature integration | — |

## 3. Personas and roles

| Role | Who | Can | Cannot |
|---|---|---|---|
| Platform Operator | 8Examples | Create organizations, manage platform settings, view platform health | Read any tenant's candidate data (break-glass only, logged and time-boxed) |
| Org Admin | Client HR lead / IT | Settings, users and roles, templates, retention, exports, feature flags, approve processes and offers | Delete any record |
| HR Advisor | Client HR staff | Create/edit processes, publish, screen, release results, schedule, send offers, view accommodation requests, view EE aggregates, export staffing files | Approve their own requests; view individual self-declarations |
| Hiring Manager | Line manager | Create processes, screen, record consensus as chair, move stages, draft offers | Publish; approve own process; view self-declaration or accommodation details |
| Assessor | Board member | View assigned processes, record scores and interview notes, book availability | See other assessors' scores before submitting own; see self-declaration or accommodation; screen |
| Auditor | Internal audit / HR oversight | Read timelines, staffing files, exports | Any write |
| Candidate | Applicant | Apply, edit before close, withdraw, self-declare, request accommodation, book interviews, accept/decline offers, export/correct/delete own data | See other candidates |

Roles are assigned per organization; Hiring Manager and Assessor are additionally scoped per process.

## 4. Ubiquitous language

- **Organization (tenant)** — a client employer. All data is partitioned by organization.
- **Hiring process (process)** — one recruitment effort for one position or pool; the unit of the staffing file. Has a human reference like `RB-2027-0004`.
- **Merit criterion** — a requirement candidates are assessed against. Types: essential, asset, organizational_need, operational_requirement, condition_of_employment. Coded E1…, A1…, O1…, R1…, C1….
- **Assessment plan** — the mapping of each criterion to one or more assessment methods (application, written_exam, interview, reference_check, portfolio, sle, other) and a rubric.
- **Rubric** — a scoring scale with bilingual level descriptors and a pass mark.
- **Poster** — the published, versioned, bilingual job advertisement for a process.
- **Posting** — the act and window of publication (opens, closes, extended, amended).
- **Application** — one candidate's response to one process; versioned on resubmission.
- **Screening** — the pass/fail check of essential criteria on the application; produces screened_in or screened_out with per-criterion marks and rationale.
- **Knockout question** — a question whose answer screens out automatically.
- **Stage** — a column in the pipeline (Applied, Screening, Assessment, …). Applications have a status and, while active, a stage.
- **Consensus** — the board's agreed score per criterion, recorded by the chair; immutable, superseded by a later consensus with reason.
- **Qualified** — all essential criteria passed at consensus.
- **Staffing file** — everything about a process, assembled from events: poster versions, criteria, plan, applications and versions, screening, scores, consensus, interviews, references, notifications, offers.
- **Timeline** — the human-readable projection of a stream's events.
- **Self-declaration** — voluntary employment-equity information; stored and keyed separately; reported only in aggregate.
- **Accommodation request** — a candidate's request for adjustments; visible to HR only.
- **Talent pool** — a set of qualified candidates who consented to be considered for future processes.
- **Crypto-shredding** — destroying a candidate's data key so their personal fields in the immutable event store become unreadable.
- **Disposition** — scheduled destruction of records under a retention rule.

## 5. Domain model

### 5.1 Aggregates and streams

| Aggregate | Stream ID | Notes |
|---|---|---|
| Organization | `org-{orgId}` | settings, branding, languages, users and roles |
| HiringProcess | `process-{processId}` | criteria, plan, stages, board, approvals, posting, status |
| Application | `application-{applicationId}` | answers, documents, consent, versions, screening, stage, scores, consensus, interviews, references, offer, hire |
| SelfDeclaration | `selfdeclaration-{applicationId}` | separate stream, separate key, separate policy |
| AccommodationRequest | `accommodation-{applicationId}` | separate stream, HR-only policy |
| Candidate | `candidate-{candidateId}` | identity, profile, language, consent history, privacy requests, pool memberships |
| NotificationTemplate | `template-{orgId}-{templateKey}` | versions per language |
| Notification | `notification-{notificationId}` | queued → sent/failed/bounced |
| RetentionRule / Disposition | `retention-{orgId}` and `disposition-{processId}` | schedules, holds, dispositions, certificates |
| Integration | `integration-{orgId}` | tokens, webhooks, adapters |
| TenantExport | `export-{exportId}` | requests and completions |

Candidate identity is per organization (the same email at two organizations is two candidates). [Decision: cross-org candidate account in v3?]

### 5.2 State machines

**HiringProcess.status**
`Draft → PendingApproval → Approved → (Scheduled) → Posted → Closed → Completed`
Side transitions: `PendingApproval → Draft` (rejected or withdrawn); `Approved → Draft` (returned, requires re-approval); `Approved | Scheduled | Posted | Closed → Cancelled`. Screening opens at `Closed` (or at `Posted` when `rolling_screening` is on). `Completed` starts the retention clock.

**Application.status** `Draft → Submitted → Active | ScreenedOut`; `Active → NotQualified | Hired`; `Draft | Submitted | Active → Withdrawn`. `Application.stage` is meaningful only while `Submitted`/`Active` and follows the process's stage list. `Application.version` increments on resubmission before closing.

**Offer.status** `Draft → PendingApproval → Approved → Sent → Accepted | Declined | Expired | Rescinded`.

**Document.scanStatus** `PendingScan → Available | Quarantined`.

### 5.3 Invariants (enforced in aggregates)

1. A poster cannot be published unless every required language has poster content, every essential criterion has ≥ 1 assessment method, the process is Approved, and the closing time is in the future.
2. Criteria and assessment plan are immutable from Approved onward; amendments after posting create a poster version and require a reason.
3. A submission is accepted only if the server clock is strictly before the closing time.
4. One application per candidate per process.
5. Screen-in requires every essential criterion marked met; screen-out requires ≥ 1 not met and a rationale ≥ 20 characters.
6. An assessor cannot read other assessors' scores for a candidate until their own scores for that candidate are submitted.
7. Consensus is required before an application leaves a stage whose method requires scoring; consensus is immutable.
8. Qualified ⇔ all essential criteria pass at current consensus.
9. Backward stage moves require a reason.
10. Requester ≠ approver for process and offer approvals.
11. Nothing is ever deleted; corrections are compensating events. Personal data is removed by crypto-shredding and projection purge, never by rewriting history.
12. Self-declaration and accommodation data never appear in any projection readable by Assessor or Hiring Manager roles.

## 6. Event catalogue

Every event carries metadata: `eventId, tenantId, streamId, streamVersion, eventType, schemaVersion, occurredAt, actor{type: staff|candidate|system|api|platform, id}, role, correlationId, causationId, reason?, locale, requestId, clientHash`. Payload fields marked `(pii)` are encrypted with the subject candidate's data key.

**Organization** — `OrganizationCreated{name, slug, timeZone}`, `OrganizationSettingsUpdated{languages[{code, required}], timeZone, settings}`, `BrandingUpdated{logo, colours, footer}`, `CustomDomainRequested/Verified{domain}`, `SenderDomainRequested/Verified{address}`, `UserInvited{email, roles}`, `UserActivated{userId}`, `UserRoleAssigned/Revoked{userId, role, scope}`, `UserDeactivated{userId}`, `FeatureFlagChanged{flag, enabled}`.

**HiringProcess** — `HiringProcessCreated{reference, title{lang}, hiringManager, hrAdvisor, location, classification?}`, `HiringProcessDetailsUpdated{...}`, `MeritCriterionAdded/Updated/Removed{code, type, text{lang}, order}`, `AssessmentMethodAssigned{criterionCode, method, rubricId}`, `RubricDefined{rubricId, scale, passMark, descriptors{lang}}`, `StageAdded/Renamed/Removed{stageId, name{lang}, candidateLabel{lang}, notifies, requiresConsensus, order}`, `BoardMemberAssigned/Removed{userId, role: chair|assessor}`, `ConflictOfInterestDeclared{userId, conflictedApplicationIds[]}`, `ApprovalRequested{by}`, `ProcessApproved{by, comment}`, `ProcessApprovalRejected{by, reason}`, `ProcessReturnedToDraft{by, reason}`, `PosterDrafted{lang, version, body}`, `PostingScheduled{publishAt, closeAt}`, `PostingPublished{version, publishedAt, closeAt}`, `PostingAmended{version, reason}`, `ClosingDateExtended{from, to, reason}`, `PostingClosed{closedAt, reason: scheduled|early|cancelled}`, `ScreeningOpened{}`, `ScreeningResultsReleased{counts}`, `ProcessCompleted{}`, `ProcessCancelled{reason}`, `ProcessRetentionClockStarted{date}`.

**Application** — `ApplicationStarted{candidateId, processId, locale}`, `ApplicationSourceAttributed{source, medium, campaign}`, `ApplicationAnswersSaved{answers(pii)}`, `DocumentAttached{documentId, kind, filename(pii), size, sha256}`, `DocumentScanned{documentId, result}`, `DocumentQuarantined{documentId}`, `DocumentRemoved{documentId}`, `ConsentRecorded{noticeVersion}`, `ApplicationSubmitted{version, answers(pii)}`, `ApplicationResubmitted{version}`, `ApplicationWithdrawn{reason?}`, `ApplicationScreenedIn{marks{criterion: met}}`, `ApplicationScreenedOut{marks, rationale, automatic, knockoutCode?}`, `ScreeningReversed{reason}`, `ApplicationMovedToStage{from, to, reason?}`, `ApplicationTagged{tags}`, `NoteAdded{text, visibility}`, `ScoreRecorded{assessorId, criterionCode, method, score, evidence}`, `ScoreAmended{...}`, `ConsensusRecorded{criterionCode, score, pass, note, supersedes?}`, `DisagreementFlagged{criterionCode}`, `ExamAssigned{criterionCode, windowStart, windowEnd, limitMinutes}`, `ExamStarted{}`, `ExamSubmitted{late}`, `ExamReleasedLate{reason}`, `InterviewSlotsPublished{slots[]}`, `InterviewInvitationSent{}`, `InterviewBooked{slotId, at}`, `InterviewRescheduled{from, to}`, `InterviewCancelled{reason}`, `InterviewNotesRecorded{criterionCode?, notes}`, `ReferenceRequested{count}`, `ReferenceProvided{referees(pii)}`, `ReferenceRecorded{source, notes(pii)}`, `ReferencesReleasedToBoard{}`, `CandidateQualified{}`, `CandidateNotQualified{failedCriteria[]}`, `AddedToPool/RemovedFromPool{poolId, expiry, reason}`, `OfferDrafted{templateId, fields(pii)}`, `OfferApprovalRequested/Approved/Rejected{...}`, `OfferSent{expiresAt}`, `OfferAccepted{typedName(pii), clientHash}`, `OfferDeclined{reason}`, `OfferExpired{}`, `OfferRescinded{reason}`, `CandidateHired{startDate}`.

**SelfDeclaration** — `SelfDeclarationRecorded{groups[](pii)}`, `SelfDeclarationWithdrawn{}`.
**AccommodationRequest** — `AccommodationRequested{text(pii), contactPreference}`, `AccommodationArranged{summary, adjustments{examTimeMultiplier?}}`.
**Candidate** — `CandidateRegistered{email(pii), locale}`, `CandidateProfileUpdated{fields(pii)}`, `CandidateEmailChangeRequested/Confirmed{newEmail(pii)}`, `MarketingOptOutSet{value}`, `CandidateDataExportRequested/Completed{}`, `CandidateDeletionRequested{}`, `CandidateDeletionDeferred{until, reason}`, `CandidateDataShredded{}`.
**Notification** — `NotificationQueued{templateKey, lang, recipientRef, causation}`, `NotificationSent{providerMessageId}`, `NotificationDeliveryFailed{attempts, error}`, `NotificationBounced{type}`.
**Retention** — `RetentionRuleDefined{recordClass, period}`, `RetentionHoldPlaced/Lifted{processId, reason}`, `DispositionScheduled{processId, date}`, `RecordDisposed{applicationId, rule}`, `DispositionCertificateIssued{certificateId}`.
**Integration** — `ApiTokenIssued/Revoked{tokenId, scopes}`, `WebhookRegistered/Removed{url, events}`, `WebhookDelivered/DeliveryFailed{deliveryId}`, `TenantExportRequested/Completed{exportId}`.

## 7. Command catalogue

Commands are imperative twins of the events above (`CreateHiringProcess`, `AddMeritCriterion`, `RequestApproval`, `ApproveProcess`, `PublishPosting`, `SubmitApplication`, `ScreenIn`, `ScreenOut`, `ReverseScreening`, `MoveToStage`, `RecordScore`, `RecordConsensus`, `PublishInterviewSlots`, `BookInterview`, `DraftOffer`, `SendOffer`, `AcceptOffer`, `RequestDataExport`, `RequestDeletion`, …). Every command has: `tenantId`, `actor`, `idempotencyKey`, `expectedVersion` (optimistic concurrency), and validation that fails with a stable machine-readable error code (`slug_taken`, `missing_language_content`, `closing_date_past`, `rationale_required`, `essential_criteria_unmet`, `consensus_required`, `conflict_of_interest`, `process_locked`, `stage_in_use`, `screening_not_open`, `priority_clearance_required`, …). Error codes are the contract Part B asserts on.

## 8. Read models (projections)

| Projection | Backing | Serves |
|---|---|---|
| `org_settings`, `users` | tables | settings, auth, role checks |
| `process_summary`, `process_detail` | tables | process list, detail, board config |
| `poster_public` | table + CDN cache | careers pages and feeds, per language and version |
| `application_detail` | table (pii columns encrypted at rest, decrypted for authorized reads) | application views |
| `pipeline_board` | table | kanban and counts, ageing |
| `screening_worklist` | table | screening |
| `assessment_workbook` | table with per-assessor visibility rules | scoring |
| `consensus_view` | table | chair's consensus screen |
| `interview_calendar` | table | slots and bookings |
| `candidate_portal` | table | candidate status page |
| `staffing_file` | materialized on demand from events | exports |
| `audit_timeline` | table | timelines |
| `notification_log` | table | delivery status |
| `metrics_daily`, `funnel`, `sources` | tables | reporting |
| `ee_aggregate` | table protected by row-level security; readable only through a security-definer function that applies suppression | employment equity reports |
| `retention_queue` | table | disposition job |
| `pools` | table | talent pools |
| `search_index` | PostgreSQL full-text (OpenSearch later) | candidate search |

Projections are rebuildable from the event store at any time; each keeps a checkpoint (`global_position`). Rebuild is a first-class operational command and a test (F17).

## 9. Architecture

### 9.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript end-to-end (Node.js 22 LTS) | one language, one toolchain |
| API | [NestJS / Fastify] REST + OpenAPI 3.1 | JSON; ETag/If-Match for optimistic concurrency |
| Web | React 19 with [Next.js / Remix] for SSR of public pages | staff app is a client-rendered SPA behind auth |
| UI components | Accessible primitives (Radix/React Aria) with a tenant-themable design system; GC Design System theme for GC tenants [decide: adopt GC Design System components directly for all tenants?] | contrast checked at theme time |
| Data | PostgreSQL 16 (event store + projections), S3-compatible object storage | ca-central-1 |
| Queue | SQS (jobs, notifications, webhooks) | at-least-once; consumers idempotent |
| Email | SES adapter (default), GC Notify adapter (GC tenants), fake adapter (tests) | provider interface with contract tests |
| Auth | OIDC (Entra ID, Google Workspace) + local email/password with TOTP for staff; magic links for candidates | see §9.11 |
| Documents | Chromium-based HTML → tagged PDF renderer; ClamAV scanning | accessible PDF gate |
| Infra | AWS: ECS Fargate, RDS PostgreSQL Multi-AZ, S3, SQS, SES, CloudFront, WAF, KMS, Secrets Manager, CloudWatch; Terraform | ca-central-1 primary, ca-west-1 DR |
| Observability | OpenTelemetry → CloudWatch/[Grafana]; structured JSON logs with PII redaction | |
| CI/CD | GitHub Actions; Playwright sharded across runners; blue/green on ECS | |

### 9.2 Event store

```sql
create table events (
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
create index events_tenant_stream on events (tenant_id, stream_id, stream_version);
create index events_type_position on events (event_type, global_position);
create table stream_locks (stream_id text primary key, tenant_id uuid not null);
create table snapshots (stream_id text primary key, stream_version integer not null, state jsonb not null, taken_at timestamptz not null);
create table projection_checkpoints (projection text primary key, global_position bigint not null, updated_at timestamptz not null);
```

Append is a single transaction: load stream version → validate `expectedVersion` → insert events → commit. Idempotency keys are stored per tenant with the resulting event IDs and the original response for 7 days. A single `NOTIFY` after commit wakes projectors; projectors also poll every second.

### 9.3 Projections

Projectors are single-writer per projection, read events in `global_position` order from their checkpoint, apply handlers in a transaction with the checkpoint update, and are idempotent on replay. Rebuild = truncate projection tables + reset checkpoint + replay. Lag is exported as a metric.

### 9.4 Process managers

Stateful reactors that turn events into commands and jobs: posting scheduler (publish/close at times), screening-results release, notification dispatcher, ageing nudges, interview reminders, offer expiry, retention/disposition, webhook delivery, export builder. Each is idempotent (keyed on `causationId`) and scheduled by a leader-elected worker.

### 9.5 Multi-tenancy

`tenant_id` on every row; every query goes through a data-access layer that requires a tenant context and adds the predicate; projection tables carry PostgreSQL row-level security policies as a second guard. Object-storage keys are prefixed by tenant; KMS keys are per tenant. Cross-tenant references return 404 (never 403) to avoid enumeration.

### 9.6 Personal information and crypto-shredding

- Each candidate has a data-encryption key (DEK) generated on registration, encrypted with the tenant's KMS key and stored in `data_keys(candidate_id, encrypted_dek, status, created_at, destroyed_at)`.
- Payload fields tagged `(pii)` are encrypted with the DEK before append (AES-256-GCM). Projections that need plaintext store it in encrypted columns (pgcrypto with the same DEK) so purge is a row delete.
- Self-declaration and accommodation streams use their own DEKs, separate from the application's, and are readable only through their own policies.
- Shredding (deletion request fulfilled, or disposition): mark DEK destroyed, delete the key material, purge projection rows, search entries and documents for that candidate/application, keep a non-identifying tombstone. History remains intact and verifiable; personal fields are permanently unreadable.
- Documents: S3 with SSE-KMS (tenant key), object names are opaque IDs; download via signed URLs valid 5 minutes; deleted on shred.

### 9.7 Notifications

Templates are versioned per language with a fixed placeholder vocabulary (`candidate_name, process_title, reference, closing_time, organization_name, stage_label, interview_time, offer_expiry, link`). A dispatcher renders in the recipient's locale (fallback to the organization's default only where the language is optional), queues the message with an idempotency key, sends through the tenant's provider adapter, records the outcome, and handles bounces via provider webhooks. Logs carry IDs only.

### 9.8 Internationalization

Locales `en-CA`, `fr-CA`. UI strings in ICU MessageFormat catalogs; content fields are `{lang: text}` maps. An organization declares its languages and whether each is required; "publishable" and "activatable" are computed from that. URLs are language-prefixed (`/en/jobs`, `/fr/emplois`); `<html lang>` is set per page and `lang` attributes wrap inline content in another language. Dates and times render with `Intl` in the viewer's locale and the organization's time zone with zone abbreviation. Server time is authoritative for all deadlines.

### 9.9 Accessibility architecture

Design-system components are the only way to build UI; each ships with an axe test and a keyboard test. Route changes move focus to the page heading and update `document.title`. Status changes use polite live regions; errors use an error summary that receives focus. PDF generation uses tagged output and is checked structurally in CI.

### 9.10 Design-system theming

A theme is `{logo, primary, secondary, surface, text, fontStack, footer}`; contrast ratios are validated at save (≥ 4.5:1 text, ≥ 3:1 UI) and the request is rejected with the measured ratio otherwise.

### 9.11 Authentication and sessions

- Staff: OIDC with group → role mapping and periodic re-check (≤ 15 min); local accounts require TOTP enrolment before any candidate data is shown; idle timeout 30 min (configurable) with an extendable warning; absolute lifetime 12 h; session IDs rotated at sign-in; admin can revoke all sessions.
- Candidates: magic links (single-use, 15-minute expiry, per-address and per-IP rate limits, neutral responses); sessions 24 h; no CAPTCHA (rate limits + honeypot instead, for accessible authentication).
- All PII reads are written to an access log (actor, resource, subject ID, purpose, time) that contains no PII.

## 10. API surface (v1)

| Area | Endpoints (prefix `/api/v1`) |
|---|---|
| Public | `GET /public/{org}/postings`, `GET /public/{org}/postings/{id}?lang=`, `GET /public/{org}/feed.{json,xml}` |
| Candidate auth | `POST /candidate/{org}/magic-link`, `GET /candidate/verify?token=`, `POST /candidate/email-change`, `POST /candidate/email-change/confirm` |
| Candidate | `GET /me`, `PATCH /me`, `GET /me/applications`, `POST /me/applications` (start), `PUT /me/applications/{id}/answers`, `POST /me/applications/{id}/documents`, `DELETE /me/applications/{id}/documents/{docId}` (draft only), `POST /me/applications/{id}/consent`, `POST /me/applications/{id}/submit`, `POST /me/applications/{id}/withdraw`, `GET /me/applications/{id}/status`, `POST /me/applications/{id}/notes`, `PUT /me/applications/{id}/self-declaration`, `DELETE /me/applications/{id}/self-declaration`, `POST /me/applications/{id}/accommodation-requests`, `GET /me/interviews/{id}/slots`, `POST /me/interviews/{id}/book`, `POST /me/interviews/{id}/reschedule`, `GET /me/offers/{id}`, `POST /me/offers/{id}/accept`, `POST /me/offers/{id}/decline`, `POST /me/data-export`, `POST /me/deletion-request`, `PUT /me/marketing-opt-out` |
| Staff — processes | `GET/POST /orgs/{org}/processes`, `GET/PATCH /processes/{id}`, `POST /processes/{id}/criteria`, `PATCH/DELETE /processes/{id}/criteria/{code}`, `PUT /processes/{id}/assessment-plan`, `PUT /processes/{id}/stages`, `PUT /processes/{id}/board`, `POST /processes/{id}/conflicts`, `POST /processes/{id}/approval-requests`, `POST /processes/{id}/approve`, `POST /processes/{id}/reject`, `POST /processes/{id}/return-to-draft`, `PUT /processes/{id}/poster/{lang}`, `POST /processes/{id}/publish`, `POST /processes/{id}/schedule`, `POST /processes/{id}/amend`, `POST /processes/{id}/extend`, `POST /processes/{id}/close`, `POST /processes/{id}/cancel`, `POST /processes/{id}/complete`, `POST /processes/{id}/clone`, `GET /processes/{id}/timeline`, `POST /processes/{id}/exports/staffing-file`, `POST /processes/{id}/release-screening-results`, `POST /processes/{id}/interview-slots`, `POST /processes/{id}/interview-invitations` |
| Staff — applications | `GET /processes/{id}/applications`, `GET /applications/{id}`, `GET /applications/{id}/documents/{docId}/download`, `POST /applications/{id}/screen-in`, `POST /applications/{id}/screen-out`, `POST /applications/{id}/reverse-screening`, `POST /applications/{id}/move`, `POST /applications/{id}/tags`, `POST /applications/{id}/notes`, `POST /applications/{id}/scores`, `POST /applications/{id}/consensus`, `POST /applications/{id}/exams`, `POST /applications/{id}/interviews/{iid}/cancel`, `POST /applications/{id}/interview-notes`, `POST /applications/{id}/references/requests`, `POST /applications/{id}/references`, `POST /applications/{id}/offers`, `POST /offers/{id}/approval-requests`, `POST /offers/{id}/approve`, `POST /offers/{id}/send`, `POST /offers/{id}/rescind`, `GET /applications/{id}/accommodation` (HR only), `POST /applications/{id}/accommodation/arrangements` |
| Reports | `GET /orgs/{org}/reports/dashboard`, `/funnel/{processId}`, `/sources`, `/ee/{processId}` (aggregate only), `POST /orgs/{org}/reports/schedules`, `GET .../export.csv` |
| Admin | `GET/PATCH /orgs/{org}/settings`, `/branding`, `/languages`, `/users`, `/roles`, `/templates/{kind}`, `/stage-templates`, `/criteria-library`, `/rubrics`, `/retention-rules`, `/holds`, `/feature-flags`, `/api-tokens`, `/webhooks`, `POST /orgs/{org}/exports` |
| Platform | `POST /platform/organizations`, `GET /platform/health` |

All staff endpoints require a tenant context; all mutations accept `Idempotency-Key`; concurrency uses `If-Match: <stream version>`.

> Implementation note: this codebase exposes the same operations in the inventory-shopify shape, `POST /api/commands/<name>` and `GET /api/queries/<name>` (see README "API"), rather than the resource paths above.

## 11. Screens

**Candidate:** careers index · poster · start/apply (email) · magic-link sent · application form (sections: contact, questions per criterion, knockout, documents, self-declaration (separate step, skippable), consent) · review and submit · confirmation · status page · accommodation request · interview booking · offer review · privacy (export, correct, delete).

**Staff:** sign-in · process list · process editor (details, criteria, assessment plan, rubrics, stages, board, poster per language, approval) · publish/schedule · pipeline board · screening worklist and per-application screening · assessment workbook (per assessor) · consensus screen (chair) · exam administration · interview slots and calendar · references · offer editor and approval · timeline · staffing-file export · reports (dashboard, funnel, sources, EE aggregate) · settings (organization, branding, languages, users, templates, stage templates, criteria library, rubrics, retention, holds, flags, tokens, webhooks, exports).

## 12. Non-functional requirements (v1)

| Requirement | Target |
|---|---|
| Availability (monthly, excluding announced maintenance) | 99.9% |
| Public poster page (cached) | p95 < 500 ms |
| Application autosave | p95 < 300 ms |
| Application submit, 500 concurrent submitters | p95 < 2 s, zero loss |
| Staff pages | p95 < 1 s |
| Projection lag | p95 < 5 s |
| Scale per tenant | 20 concurrent processes; 20,000 applications/year; 10 years of records |
| Tenants | 50 (v1.1), 500 (v3) |
| RPO / RTO | 15 min / 4 h |
| Backups | daily snapshot + PITR, 35 days, replicated to ca-west-1, quarterly restore drill |
| Data residency | ca-central-1 and ca-west-1 only |
| Browser support | last 2 versions of Chrome, Edge, Firefox, Safari; iOS Safari and Android Chrome |
| Assistive technology | NVDA+Firefox, JAWS+Chrome, VoiceOver+Safari (macOS, iOS), TalkBack |
| Log retention | 1 year; access logs 2 years; events until disposition |

## 13. Security and privacy requirements

- OWASP ASVS Level 2 as the checklist; annual external penetration test; pen test before the first paying client.
- TLS 1.2+ (prefer 1.3); HSTS; CSP without `unsafe-inline` scripts; SameSite cookies; CSRF protection; security headers per F26.
- Encryption at rest with customer-managed KMS keys per tenant; per-candidate envelope encryption for PII (§9.6).
- MFA for all staff; least-privilege IAM; secrets in Secrets Manager; no secrets in code or logs (CI gate).
- Dependency, container and code scanning in CI (fail on critical/high); ClamAV plus content sniffing on every upload.
- Access logging for all PII reads; security log for auth events, denials and rate limiting.
- Tenant isolation in the data layer plus row-level security; IDOR tests in CI (F26).
- Privacy: PIPEDA and provincial private-sector law for non-profits; provincial FOIP/public-sector privacy law for municipalities and public bodies; federal Privacy Act for GC tenants. Versioned privacy notice; consent at application; data minimization (no SIN, no date of birth by default); candidate rights via self-serve (F18); retention and disposition (F19); breach runbook with tenant notification timelines. [Lawyer review of notice, DPA and retention defaults before go-live.]

## 14. Accessibility requirements

- WCAG 2.1 Level AA on all user-facing pages, PDFs and emails; WCAG 2.2 criteria adopted: 2.4.11 Focus Not Obscured, 2.5.8 Target Size (24×24), 3.3.7 Redundant Entry, 3.3.8 Accessible Authentication (no CAPTCHA, no cognitive tests).
- CI gate: axe-core with zero serious/critical violations on every page in both languages (F24).
- Manual AT test plan per release on the application form, booking page and pipeline board; third-party audit before v1 exit and annually.
- Accessibility statement in both languages with a feedback channel; AA failures are Severity 2 defects.

## 15. Operations and infrastructure

- Terraform modules: `network`, `ecs-service`, `rds-postgres`, `s3-documents`, `kms`, `sqs`, `ses`, `cloudfront-waf`, `monitoring`, `backup`, `dr-replica`. Environments: `dev`, `staging`, `prod`, each from the same code.
- Pipeline: lint → typecheck → unit → integration (Postgres container) → build → e2e (Playwright, sharded) → a11y → SAST/dependency scan → deploy staging → smoke → manual gate → prod (blue/green) → post-deploy smoke.
- Alerts (F28): 5xx rate, p95 latency, queue age, projection lag, failed sign-in spike, certificate expiry, backup failure.
- Runbooks: deploy/rollback, projection rebuild, key rotation, restore, DR failover, suspected breach, tenant offboarding.

## 16. Testing strategy and Gherkin conventions

**Layers.** Domain scenarios (fast, in-memory) exercise invariants and event emission; application scenarios run the API against PostgreSQL with a fake clock, fake email provider, fake scanner and deterministic IDs; UI scenarios run Playwright against a seeded environment; infrastructure scenarios run against `staging` in CI nightly and against `prod` read-only.

**Fixtures** (seeded by name):

- `the "Riverbend" organization` — Riverbend Municipality, slug `riverbend`, languages en (required) + fr (required), time zone America/Edmonton. Users: Sam (Org Admin), Priya (HR Advisor), Marc (Hiring Manager), Dana and Kai (Assessors), Lee (Auditor). Default stages: Applied, Screening, Assessment, Interview, Reference Check, Qualified, Offer, Hired. Retention: unsuccessful 2 years, hired 7 years after completion. Suppression threshold 5.
- `the "Harbour" organization` — Harbour Community Services, slug `harbour`, en (required) + fr (optional), America/Vancouver, local accounts. Users: Noor (Org Admin + HR Advisor).
- `the process "Developer 2027-01"` — Riverbend; reference RB-2027-0001; hiring manager Marc; HR advisor Priya; board Dana, Kai; criteria E1 "Experience developing web applications", E2 "Experience applying accessibility standards", A1 "Experience in the public sector"; plan E1 application+interview, E2 application+written_exam, A1 application; rubric 0–5, pass 3; knockout K1 "Are you legally entitled to work in Canada?" expects Yes; posted 2027-01-05 09:00, closes 2027-01-19 23:59 America/Edmonton.
- Candidates: Amina (en), Chloé (fr), Jordan (en), Wei (en), Fatima (fr), all at `<name>@example.com`.
- `the current time is "…" in <zone>` controls the fake clock; `when the current time becomes "…"` advances it and runs due schedulers.

**Step vocabulary.** "I am signed in as X" (staff session); "X opens/activates/enters/uploads/submits …" (UI or API as the layer dictates); "the request is rejected with error `<code>`" asserts the machine-readable error; "the event `<Type>` is recorded [on stream S] [with …]" asserts the event store; "an email in <lang> is sent to X with template T" asserts the fake provider; "the response status is N"; "the timeline shows …"; "within N seconds" is a polling assertion with that timeout.

**Definition of done for a scenario:** automated at the right layer, green in CI, tagged, and linked to the feature by ID.

## 17. Delivery plan (v1, solo with AI-assisted development)

| Week | Deliverable |
|---|---|
| 1 | Repo, CI, Terraform `dev`, event store, projections framework, tenancy, fake clock/providers; F01, F26 skeleton |
| 2 | Auth (F02, F03), roles (F04), i18n framework (F25), design system base with axe tests (F24) |
| 3 | Process editor, criteria, plan, approvals (F05); templates (F21) |
| 4 | Posting, careers page, feeds (F06); application form, uploads, scanning, consent, submit (F07) |
| 5 | Self-declaration and accommodation (F08); screening (F09); pipeline (F10); notifications (F16) |
| 6 | Assessment and consensus (F11); interviews (F12); offers (F15) |
| 7 | Staffing file and timeline (F17); privacy rights (F18); reporting (F20); tenant export (F23) |
| 8 | Performance (F27), ops (F28), security hardening, manual AT pass, external a11y audit booked, first design partner onboarded |

Aggressive by design; the scope cut list is F12 self-booking (fall back to HR-entered times), F20 scheduled reports, and F15 approval workflow (single approver).

## 18. Open decisions

1. Product name and domain.
2. API framework (NestJS vs Fastify) and web framework (Next.js vs Remix). *(Built on Next.js, matching inventory-shopify.)*
3. Design system: adopt GC Design System components for all tenants with theming, or own primitives.
4. Email provider (SES vs Postmark) and whether GC Notify is v1.1 or v2.
5. E-signature: typed-name acceptance (v1) vs vendor integration (v3).
6. Cross-organization candidate accounts.
7. Retention defaults per record class and jurisdiction (with counsel).
8. Pricing model (flat per organization per month, tiered by hires/year; no per-seat).
9. French translation partner for UI catalog review.
10. Accessibility auditor and penetration tester.

---

# Part B — Gherkin features

The features F01–F31 and their scenarios (330 in total) are the acceptance contract. The automated scenarios in this repository reference them by feature ID; each `describe`/`it` in `tests/` is named after the scenario it implements. Features F13, F14, F19, F22, F24 (automated axe), F27, F28 (infrastructure), F29, F30 and F31 are not yet automated (see README).

## Appendix B — Error codes referenced in Part B

`slug_taken`, `slug_invalid`, `contrast_insufficient`, `cannot_approve_own_request`, `assessment_plan_incomplete`, `rubric_missing`, `process_locked`, `reason_required`, `missing_language_content`, `closing_date_past`, `approval_required`, `use_close_early`, `file_type_not_allowed`, `file_too_large`, `file_content_mismatch`, `application_submitted`, `posting_closed`, `screening_not_open`, `rationale_required`, `rationale_too_short`, `essential_criteria_unmet`, `application_withdrawn`, `screening_incomplete`, `stage_in_use`, `consensus_required`, `candidate_not_qualified`, `conflict_of_interest`, `evidence_required`, `score_out_of_range`, `scores_incomplete`, `immutable`, `exam_window_closed`, `slot_overlap`, `slot_no_longer_available`, `reschedule_cutoff_passed`, `unknown_placeholder`, `https_required`, `priority_clearance_required`.

## Appendix C — Event-to-feature index (where each event is first asserted)

OrganizationCreated F01 · OrganizationSettingsUpdated F01 · BrandingUpdated F01 · FeatureFlagChanged F01 · UserActivated F02 · UserRoleRevoked F02 · UserDeactivated F02 · CandidateEmailChangeConfirmed F03 · HiringProcessCreated F05 · MeritCriterionAdded/Updated F05 · ApprovalRequested F05 · ProcessApproved F05 · ProcessApprovalRejected F05 · ProcessReturnedToDraft F05 · ProcessCancelled F05 · ProcessCompleted F05 · ProcessRetentionClockStarted F05 · PostingPublished F06 · PostingClosed F06 · ClosingDateExtended F06 · PostingAmended F06 · ApplicationSourceAttributed F06 · ApplicationStarted F07 · ApplicationAnswersSaved F07 · DocumentQuarantined F07 · DocumentRemoved/Attached F07 · ConsentRecorded F07 · ApplicationSubmitted F07 · ApplicationResubmitted F07 · ApplicationWithdrawn F07 · SelfDeclarationRecorded/Withdrawn F08 · AccommodationRequested F08 · ScreeningOpened F09 · ApplicationScreenedIn/Out F09 · ScreeningReversed F09 · ScreeningResultsReleased F09 · StageAdded/Removed F10 · ApplicationMovedToStage F10 · ApplicationTagged F10 · ConflictOfInterestDeclared F11 · ScoreAmended F11 · ConsensusRecorded F11 · DisagreementFlagged F11 · CandidateQualified/NotQualified F11 · ExamStarted/Submitted/ReleasedLate F11 · InterviewSlotsPublished F12 · InterviewInvitationSent F12 · InterviewBooked/Rescheduled/Cancelled F12 · ReferenceProvided/Recorded F13 · ReferencesReleasedToBoard F13 · AddedToPool/RemovedFromPool F14 · OfferDrafted/Approved/Sent/Accepted/Declined/Expired/Rescinded F15 · CandidateHired F15 · NotificationQueued/DeliveryFailed/Bounced F16 · CandidateDataExportRequested/Completed F18 · CandidateProfileUpdated F18 · CandidateDeletionDeferred F18 · CandidateDataShredded F18 · RetentionHoldPlaced F19 · RecordDisposed F19 · DispositionCertificateIssued F19 · UserRoleAssigned F21 · ApiTokenIssued F22 · WebhookDelivered/DeliveryFailed F22 · TenantExportRequested/Completed F23 · PriorityClearanceRecorded F31.
