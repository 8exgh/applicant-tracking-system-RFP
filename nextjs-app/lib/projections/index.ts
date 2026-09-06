import { Tx } from '@/lib/db/pool';
import { readFromPosition, StoredEvent } from '@/lib/db/event-store';
import { streamType, streamEntityId } from '@/types/events';
import { isEnvelope } from '@/lib/crypto/pii';
import { evolveProcess, initialProcessState, HiringProcessState } from '@/lib/domain/hiring-process';
import { evolveApplication, initialApplicationState, ApplicationState, currentOffer } from '@/lib/domain/application';
import { toReplay } from '@/lib/app/context';
import { getLogger } from '@/lib/logger';
import { now } from '@/lib/clock';

const log = getLogger('projections');

// Projectors are single-writer per projection, read events in global_position
// order from their checkpoint, and are idempotent on replay (spec §9.3).
export interface Projector {
  name: string;
  tables: string[];
  apply(tx: Tx, event: StoredEvent): Promise<void>;
}

function at(e: StoredEvent): Date { return e.occurredAt; }

async function readCheckpoint(tx: Tx, name: string): Promise<number> {
  const { rows } = await tx.query('select global_position from projection_checkpoints where projection = $1', [name]);
  return rows[0] ? Number(rows[0].global_position) : 0;
}

async function writeCheckpoint(tx: Tx, name: string, position: number): Promise<void> {
  await tx.query(
    'insert into projection_checkpoints (projection, global_position, updated_at) values ($1, $2, $3) on conflict (projection) do update set global_position = excluded.global_position, updated_at = excluded.updated_at',
    [name, position, now()]
  );
}

// ---------- process_summary ----------
async function loadProcessState(tx: Tx, tenantId: string, processId: string): Promise<HiringProcessState> {
  const { rows } = await tx.query('select * from events where tenant_id = $1 and stream_id = $2 order by stream_version', [tenantId, `process-${processId}`]);
  return toReplay(rows.map(rowToEvent)).reduce(evolveProcess, initialProcessState());
}

async function loadApplicationState(tx: Tx, tenantId: string, applicationId: string): Promise<ApplicationState> {
  const { rows } = await tx.query('select * from events where tenant_id = $1 and stream_id = $2 order by stream_version', [tenantId, `application-${applicationId}`]);
  return toReplay(rows.map(rowToEvent)).reduce(evolveApplication, initialApplicationState());
}

function rowToEvent(row: Record<string, any>): StoredEvent {
  return { globalPosition: Number(row.global_position), tenantId: row.tenant_id, streamId: row.stream_id, streamVersion: row.stream_version, type: row.event_type, schemaVersion: row.schema_version, payload: row.payload, metadata: row.metadata, occurredAt: new Date(row.occurred_at) };
}

const processSummary: Projector = {
  name: 'process_summary',
  tables: ['process_summary'],
  async apply(tx, e) {
    if (streamType(e.streamId) !== 'process') return;
    const processId = streamEntityId(e.streamId);
    const s = await loadProcessState(tx, e.tenantId, processId);
    if (!s.exists) return;
    await tx.query(`
      insert into process_summary (id, tenant_id, reference, slug, title, status, hiring_manager_id, hr_advisor_id, location, classification, criteria, plan, rubrics, stages, board, conflicts, knockouts, poster, poster_version, publish_at, close_at, published_at, closed_at, completed_at, screening_open, approval, version, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
      on conflict (id) do update set reference = excluded.reference, slug = excluded.slug, title = excluded.title, status = excluded.status, hiring_manager_id = excluded.hiring_manager_id, hr_advisor_id = excluded.hr_advisor_id,
        location = excluded.location, classification = excluded.classification, criteria = excluded.criteria, plan = excluded.plan, rubrics = excluded.rubrics, stages = excluded.stages, board = excluded.board, conflicts = excluded.conflicts,
        knockouts = excluded.knockouts, poster = excluded.poster, poster_version = excluded.poster_version, publish_at = excluded.publish_at, close_at = excluded.close_at, published_at = excluded.published_at, closed_at = excluded.closed_at,
        completed_at = excluded.completed_at, screening_open = excluded.screening_open, approval = excluded.approval, version = excluded.version, updated_at = excluded.updated_at`,
      [processId, e.tenantId, s.reference, s.slug, JSON.stringify(s.title), s.status, s.hiringManagerId || null, s.hrAdvisorId || null, s.location, s.classification ?? null,
        JSON.stringify(s.criteria), JSON.stringify(s.plan), JSON.stringify(s.rubrics), JSON.stringify(s.stages), JSON.stringify(s.board), JSON.stringify(s.conflicts), JSON.stringify(s.knockouts),
        JSON.stringify(s.poster), s.posterVersion, s.publishAt ?? null, s.closeAt ?? null, s.publishedAt ?? null, s.closedAt ?? null, s.completedAt ?? null, s.screeningOpen,
        JSON.stringify(s.approval), s.version, s.createdAt ?? at(e), at(e)]
    );
  }
};

// ---------- poster_public ----------
const posterPublic: Projector = {
  name: 'poster_public',
  tables: ['poster_public'],
  async apply(tx, e) {
    if (streamType(e.streamId) !== 'process') return;
    if (!['PostingScheduled', 'PostingPublished', 'PostingAmended', 'ClosingDateExtended', 'PostingClosed', 'ProcessCancelled', 'PosterDrafted', 'HiringProcessDetailsUpdated'].includes(e.type)) return;
    const processId = streamEntityId(e.streamId);
    const s = await loadProcessState(tx, e.tenantId, processId);
    if (!['Scheduled', 'Posted', 'Closed', 'Cancelled', 'Completed'].includes(s.status)) return;
    const status = s.status === 'Scheduled' ? 'scheduled' : s.status === 'Posted' ? 'open' : s.status === 'Cancelled' ? 'cancelled' : 'closed';
    const amended = s.posterHistory.length > 1 ? s.posterHistory[s.posterHistory.length - 1].at : null;
    await tx.query(`
      insert into poster_public (process_id, tenant_id, slug, version, title, body, location, close_at, published_at, amended_at, status)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      on conflict (process_id) do update set slug = excluded.slug, version = excluded.version, title = excluded.title, body = excluded.body, location = excluded.location,
        close_at = excluded.close_at, published_at = excluded.published_at, amended_at = excluded.amended_at, status = excluded.status`,
      [processId, e.tenantId, s.slug, s.posterVersion, JSON.stringify(s.title), JSON.stringify(s.poster), s.location, s.closeAt ?? null, s.publishedAt ?? null, amended, status]
    );
  }
};

// ---------- application_summary ----------
const applicationSummary: Projector = {
  name: 'application_summary',
  tables: ['application_summary'],
  async apply(tx, e) {
    const kind = streamType(e.streamId);
    if (kind === 'notification' && e.type === 'NotificationBounced') {
      const p = e.payload as Record<string, any>;
      if (p.recipientKind === 'candidate') {
        await tx.query('update application_summary set email_bounced = true, updated_at = $3 where tenant_id = $1 and candidate_id = $2', [e.tenantId, p.recipientRef, at(e)]);
        await tx.query('update candidates set email_bounced = true, updated_at = $3 where tenant_id = $1 and id = $2', [e.tenantId, p.recipientRef, at(e)]);
      }
      return;
    }
    if (kind !== 'application') return;
    const applicationId = streamEntityId(e.streamId);
    const s = await loadApplicationState(tx, e.tenantId, applicationId);
    if (!s.exists) return;
    const offer = currentOffer(s);
    const screening = s.screening ? { result: s.screening.result, automatic: s.screening.automatic, knockoutCode: s.screening.knockoutCode, at: s.screening.at } : null;
    await tx.query(`
      insert into application_summary (id, tenant_id, process_id, candidate_id, status, stage, stage_entered_at, version, locale, source, tags, screening, qualified, offer, hired_at, withdrawn_at, submitted_at, stream_version, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      on conflict (id) do update set status = excluded.status, stage = excluded.stage, stage_entered_at = excluded.stage_entered_at, version = excluded.version, locale = excluded.locale, source = excluded.source,
        tags = excluded.tags, screening = excluded.screening, qualified = excluded.qualified, offer = excluded.offer, hired_at = excluded.hired_at, withdrawn_at = excluded.withdrawn_at, submitted_at = excluded.submitted_at,
        stream_version = excluded.stream_version, updated_at = excluded.updated_at`,
      [applicationId, e.tenantId, s.processId, s.candidateId, s.status, s.stage ?? null, s.stageEnteredAt ?? null, s.version, s.locale, s.source ? JSON.stringify(s.source) : null,
        JSON.stringify(s.tags), screening ? JSON.stringify(screening) : null, s.qualified, offer ? JSON.stringify({ offerId: offer.offerId, status: offer.status, expiresAt: offer.expiresAt, sentAt: offer.sentAt }) : null,
        s.hiredAt ?? null, s.withdrawnAt ?? null, s.submittedAt ?? null, s.streamVersion, s.startedAt ?? at(e), at(e)]
    );
    if (e.type === 'DocumentScanned' || e.type === 'DocumentQuarantined' || e.type === 'DocumentRemoved') {
      const p = e.payload as Record<string, any>;
      const doc = s.documents.find(d => d.documentId === p.documentId);
      if (doc) await tx.query('update documents set scan_status = $3, removed = $4, content = case when $4 or $3 = $5 then null else content end where tenant_id = $1 and id = $2', [e.tenantId, p.documentId, doc.scanStatus, doc.removed, 'Quarantined']);
    }
  }
};

// ---------- candidates ----------
const candidates: Projector = {
  name: 'candidates',
  tables: ['candidates', 'shred_tombstones'],
  async apply(tx, e) {
    if (streamType(e.streamId) !== 'candidate') return;
    const id = streamEntityId(e.streamId);
    const p = e.payload as Record<string, any>;
    switch (e.type) {
      case 'CandidateRegistered':
        await tx.query(
          `insert into candidates (id, tenant_id, email_hash, email_enc, key_id, locale, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $7)
           on conflict (id) do update set email_enc = excluded.email_enc, locale = excluded.locale, updated_at = excluded.updated_at`,
          [id, e.tenantId, p.emailHash, JSON.stringify(p.email), `candidate:${id}`, p.locale ?? 'en', at(e)]
        );
        break;
      case 'CandidateProfileUpdated':
        await tx.query('update candidates set profile_enc = $3, updated_at = $4 where tenant_id = $1 and id = $2', [e.tenantId, id, JSON.stringify(p.fields), at(e)]);
        break;
      case 'CandidateLocaleChanged':
        await tx.query('update candidates set locale = $3, updated_at = $4 where tenant_id = $1 and id = $2', [e.tenantId, id, p.locale, at(e)]);
        await tx.query('update application_summary set locale = $3, updated_at = $4 where tenant_id = $1 and candidate_id = $2', [e.tenantId, id, p.locale, at(e)]);
        break;
      case 'CandidateEmailChangeConfirmed':
        await tx.query('update candidates set email_enc = $3, email_hash = $4, email_bounced = false, updated_at = $5 where tenant_id = $1 and id = $2', [e.tenantId, id, JSON.stringify(p.newEmail), p.emailHash, at(e)]);
        break;
      case 'MarketingOptOutSet':
        await tx.query('update candidates set marketing_opt_out = $3, updated_at = $4 where tenant_id = $1 and id = $2', [e.tenantId, id, !!p.value, at(e)]);
        break;
      case 'CandidateDeletionDeferred':
        await tx.query('update candidates set deletion_deferred_until = $3, updated_at = $4 where tenant_id = $1 and id = $2', [e.tenantId, id, p.until, at(e)]);
        break;
      case 'CandidateDataShredded':
        // Purge everything personal; keep a non-identifying tombstone (F18)
        await tx.query("update candidates set email_enc = null, profile_enc = null, status = 'Removed', shredded_at = $3, updated_at = $3 where tenant_id = $1 and id = $2", [e.tenantId, id, at(e)]);
        await tx.query('update documents set content = null, filename_enc = null, removed = true where tenant_id = $1 and candidate_id = $2', [e.tenantId, id]);
        await tx.query('delete from ee_declarations where tenant_id = $1 and application_id in (select id from application_summary where tenant_id = $1 and candidate_id = $2)', [e.tenantId, id]);
        await tx.query('delete from accommodations where tenant_id = $1 and application_id in (select id from application_summary where tenant_id = $1 and candidate_id = $2)', [e.tenantId, id]);
        await tx.query("update notification_queue set subject_enc = null, body_enc = null, address_enc = null where tenant_id = $1 and recipient_kind = 'candidate' and recipient_ref = $2", [e.tenantId, id]);
        await tx.query(
          "insert into shred_tombstones (subject_id, tenant_id, kind, reason, shredded_at) values ($1, $2, 'candidate', $3, $4) on conflict (subject_id) do nothing",
          [id, e.tenantId, p.reason ?? 'deletion_request', at(e)]
        );
        break;
    }
  }
};

// ---------- audit_timeline ----------
const CATEGORY: Record<string, string> = {
  ApplicationScreenedIn: 'screening', ApplicationScreenedOut: 'screening', ScreeningReversed: 'screening', ScreeningOpened: 'screening', ScreeningResultsReleased: 'screening',
  ScoreRecorded: 'assessment', ScoreAmended: 'assessment', ScoresSubmitted: 'assessment', ConsensusRecorded: 'assessment', DisagreementFlagged: 'assessment',
  ExamAssigned: 'assessment', ExamStarted: 'assessment', ExamSubmitted: 'assessment', ExamReleasedLate: 'assessment', CandidateQualified: 'assessment', CandidateNotQualified: 'assessment',
  InterviewSlotsPublished: 'interview', InterviewInvitationSent: 'interview', InterviewBooked: 'interview', InterviewRescheduled: 'interview', InterviewCancelled: 'interview', InterviewNotesRecorded: 'interview', InterviewSlotBooked: 'interview', InterviewSlotReleased: 'interview',
  OfferDrafted: 'offer', OfferApprovalRequested: 'offer', OfferApproved: 'offer', OfferApprovalRejected: 'offer', OfferSent: 'offer', OfferAccepted: 'offer', OfferDeclined: 'offer', OfferExpired: 'offer', OfferRescinded: 'offer', CandidateHired: 'offer',
  NotificationQueued: 'notification', NotificationSent: 'notification', NotificationDeliveryFailed: 'notification', NotificationBounced: 'notification'
};

function redact(value: unknown): unknown {
  if (isEnvelope(value)) return '[encrypted]';
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
  return value;
}

const auditTimeline: Projector = {
  name: 'audit_timeline',
  tables: ['audit_timeline'],
  async apply(tx, e) {
    const kind = streamType(e.streamId);
    const id = streamEntityId(e.streamId);
    let processId: string | null = null;
    let applicationId: string | null = null;
    const p = e.payload as Record<string, any>;
    if (kind === 'process') processId = id;
    else if (kind === 'application') { applicationId = id; processId = (await tx.query('select process_id from application_summary where tenant_id = $1 and id = $2', [e.tenantId, id])).rows[0]?.process_id ?? p.processId ?? null; }
    else if (kind === 'selfdeclaration' || kind === 'accommodation') { applicationId = id; processId = p.processId ?? null; }
    else if (kind === 'notification') { applicationId = p.applicationId ?? null; processId = p.processId ?? null; }
    const category = CATEGORY[e.type] ?? (kind === 'process' ? 'process' : kind === 'application' ? 'application' : kind === 'org' ? 'organization' : kind === 'candidate' ? 'privacy' : kind);
    // Self-declaration content never reaches the timeline; only that a record exists
    const summary = kind === 'selfdeclaration' ? {} : redact(p);
    await tx.query(
      `insert into audit_timeline (global_position, tenant_id, stream_id, stream_type, process_id, application_id, event_type, category, actor, reason, causation_id, summary, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict (global_position) do nothing`,
      [e.globalPosition, e.tenantId, e.streamId, kind, processId, applicationId, e.type, category, JSON.stringify({ ...e.metadata.actor, role: e.metadata.role }), e.metadata.reason ?? null, e.metadata.causationId ?? null, JSON.stringify(summary), at(e)]
    );
  }
};

// ---------- notifications ----------
const notifications: Projector = {
  name: 'notification_queue',
  tables: ['notification_queue', 'notification_templates'],
  async apply(tx, e) {
    const kind = streamType(e.streamId);
    const p = e.payload as Record<string, any>;
    if (kind === 'template') {
      if (e.type === 'NotificationTemplateSaved') {
        await tx.query(
          'insert into notification_templates (tenant_id, key, lang, version, subject, body, active, updated_at) values ($1, $2, $3, $4, $5, $6, true, $7) on conflict do nothing',
          [e.tenantId, p.key, p.lang, p.version, p.subject, p.body, at(e)]
        );
      }
      return;
    }
    if (kind !== 'notification') return;
    const id = streamEntityId(e.streamId);
    switch (e.type) {
      case 'NotificationQueued':
        await tx.query(
          `insert into notification_queue (id, tenant_id, template_key, lang, recipient_kind, recipient_ref, address_enc, key_id, subject_enc, body_enc, fallback, status, causation_id, queued_at, next_attempt_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'queued', $12, $13, $13) on conflict (id) do nothing`,
          [id, e.tenantId, p.templateKey, p.lang, p.recipientKind, p.recipientRef, JSON.stringify(p.address), p.keyId, JSON.stringify(p.subject), JSON.stringify(p.body), p.fallback ?? null, p.causationEventId ?? null, at(e)]
        );
        break;
      case 'NotificationSent':
        await tx.query("update notification_queue set status = 'sent', provider_message_id = $3, sent_at = $4, attempts = attempts + 1 where tenant_id = $1 and id = $2", [e.tenantId, id, p.providerMessageId ?? null, at(e)]);
        break;
      case 'NotificationDeliveryFailed':
        await tx.query("update notification_queue set status = $3, attempts = $4, last_error = $5, next_attempt_at = $6 where tenant_id = $1 and id = $2", [e.tenantId, id, p.final ? 'failed' : 'queued', p.attempts, p.error ?? null, p.nextAttemptAt ?? null]);
        break;
      case 'NotificationBounced':
        await tx.query("update notification_queue set status = 'bounced' where tenant_id = $1 and id = $2", [e.tenantId, id]);
        break;
    }
  }
};

// ---------- interview_slots ----------
const interviewSlots: Projector = {
  name: 'interview_slots',
  tables: ['interview_slots'],
  async apply(tx, e) {
    if (streamType(e.streamId) !== 'process') return;
    if (!['InterviewSlotsPublished', 'InterviewSlotBooked', 'InterviewSlotReleased'].includes(e.type)) return;
    const processId = streamEntityId(e.streamId);
    const s = await loadProcessState(tx, e.tenantId, processId);
    for (const slot of s.slots) {
      await tx.query(
        `insert into interview_slots (id, tenant_id, process_id, starts_at, ends_at, board, status, application_id, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set status = excluded.status, application_id = excluded.application_id, updated_at = excluded.updated_at`,
        [slot.slotId, e.tenantId, processId, slot.startsAt, slot.endsAt, JSON.stringify(slot.boardUserIds), slot.status, slot.applicationId ?? null, at(e)]
      );
    }
  }
};

// ---------- self-declarations & accommodations ----------
const restricted: Projector = {
  name: 'restricted',
  tables: ['ee_declarations', 'accommodations'],
  async apply(tx, e) {
    const kind = streamType(e.streamId);
    const p = e.payload as Record<string, any>;
    if (kind === 'selfdeclaration') {
      const applicationId = streamEntityId(e.streamId);
      if (e.type === 'SelfDeclarationRecorded') {
        await tx.query(
          `insert into ee_declarations (application_id, tenant_id, process_id, groups_enc, key_id, withdrawn, updated_at) values ($1, $2, $3, $4, $5, false, $6)
           on conflict (application_id) do update set groups_enc = excluded.groups_enc, withdrawn = false, updated_at = excluded.updated_at`,
          [applicationId, e.tenantId, p.processId, JSON.stringify(p.groups), `selfdeclaration:${applicationId}`, at(e)]
        );
      } else if (e.type === 'SelfDeclarationWithdrawn') {
        await tx.query('update ee_declarations set withdrawn = true, groups_enc = null, updated_at = $3 where tenant_id = $1 and application_id = $2', [e.tenantId, applicationId, at(e)]);
      }
    } else if (kind === 'accommodation') {
      const applicationId = streamEntityId(e.streamId);
      if (e.type === 'AccommodationRequested') {
        await tx.query(
          `insert into accommodations (id, tenant_id, application_id, process_id, text_enc, key_id, contact_preference, stage, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) on conflict (id) do nothing`,
          [p.requestId, e.tenantId, applicationId, p.processId, JSON.stringify(p.text), `accommodation:${applicationId}`, p.contactPreference ?? null, p.stage ?? null, at(e)]
        );
      } else if (e.type === 'AccommodationArranged') {
        await tx.query('update accommodations set arrangement = $3, updated_at = $4 where tenant_id = $1 and id = $2', [e.tenantId, p.requestId, JSON.stringify({ summary: p.summary, adjustments: p.adjustments ?? {} }), at(e)]);
      }
    }
  }
};

// ---------- org directory + users ----------
const orgDirectory: Projector = {
  name: 'org_settings',
  tables: ['org_settings', 'users'],
  async apply(tx, e) {
    if (streamType(e.streamId) !== 'org') return;
    const p = e.payload as Record<string, any>;
    switch (e.type) {
      case 'OrganizationCreated':
        await tx.query(
          `insert into org_settings (tenant_id, slug, name, time_zone, languages, settings, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $7)
           on conflict (tenant_id) do update set slug = excluded.slug, name = excluded.name, time_zone = excluded.time_zone, languages = excluded.languages, updated_at = excluded.updated_at`,
          [e.tenantId, p.slug, p.name, p.timeZone, JSON.stringify(p.languages), JSON.stringify(p.settings ?? {}), at(e)]
        );
        break;
      case 'OrganizationSettingsUpdated':
        await tx.query(
          `update org_settings set languages = coalesce($2, languages), time_zone = coalesce($3, time_zone), name = coalesce($4, name), settings = settings || $5::jsonb, updated_at = $6 where tenant_id = $1`,
          [e.tenantId, p.languages ? JSON.stringify(p.languages) : null, p.timeZone ?? null, p.name ?? null, JSON.stringify(p.settings ?? {}), at(e)]
        );
        break;
      case 'BrandingUpdated':
        await tx.query('update org_settings set branding = branding || $2::jsonb, updated_at = $3 where tenant_id = $1', [e.tenantId, JSON.stringify(p), at(e)]);
        break;
      case 'FeatureFlagChanged':
        await tx.query('update org_settings set feature_flags = feature_flags || $2::jsonb, updated_at = $3 where tenant_id = $1', [e.tenantId, JSON.stringify({ [p.flag]: !!p.enabled }), at(e)]);
        break;
      case 'StageTemplateUpdated':
        await tx.query("update org_settings set settings = settings || jsonb_build_object('stageTemplate', $2::jsonb), updated_at = $3 where tenant_id = $1", [e.tenantId, JSON.stringify(p.stages), at(e)]);
        break;
      case 'UserInvited':
        await tx.query(
          `insert into users (id, tenant_id, email, display_name, roles, language, status, invited_at) values ($1, $2, $3, $4, $5, $6, 'Invited', $7)
           on conflict (id) do update set email = excluded.email, display_name = excluded.display_name, roles = excluded.roles, language = excluded.language`,
          [p.userId, e.tenantId, p.email, p.displayName ?? '', JSON.stringify(p.roles ?? []), p.language ?? 'en', at(e)]
        );
        await tx.query('insert into credentials (user_id) values ($1) on conflict do nothing', [p.userId]);
        break;
      case 'UserActivated':
        await tx.query("update users set status = 'Active', activated_at = coalesce(activated_at, $2) where id = $1", [p.userId, at(e)]);
        break;
      case 'UserRoleAssigned':
        await tx.query("update users set roles = (select jsonb_agg(distinct x) from jsonb_array_elements(roles || to_jsonb(array[$2::text])) x) where id = $1", [p.userId, p.role]);
        break;
      case 'UserRoleRevoked':
        await tx.query("update users set roles = coalesce((select jsonb_agg(x) from jsonb_array_elements(roles) x where x <> to_jsonb($2::text)), '[]'::jsonb) where id = $1", [p.userId, p.role]);
        break;
      case 'UserLanguageChanged':
        await tx.query('update users set language = $2 where id = $1', [p.userId, p.language]);
        break;
      case 'UserDeactivated':
        await tx.query("update users set status = 'Deactivated' where id = $1", [p.userId]);
        await tx.query('update sessions set revoked_at = $2 where subject_id = $1 and revoked_at is null', [p.userId, at(e)]);
        break;
    }
  }
};

export const projectors: Projector[] = [orgDirectory, candidates, processSummary, posterPublic, applicationSummary, interviewSlots, auditTimeline, notifications, restricted];

// Catch every projector up to the head. Called inside command transactions
// (under the global command lock) and by the operational catch-up job.
export async function runProjections(tx: Tx, only?: string): Promise<number> {
  let applied = 0;
  for (const projector of projectors) {
    if (only && projector.name !== only) continue;
    let checkpoint = await readCheckpoint(tx, projector.name);
    for (;;) {
      const batch = await readFromPosition(tx, checkpoint, 500);
      if (!batch.length) break;
      for (const event of batch) {
        try {
          await projector.apply(tx, event);
        } catch (err) {
          log.error(`${projector.name} failed at ${event.globalPosition} (${event.type})`, err);
          throw err;
        }
        checkpoint = event.globalPosition;
        applied++;
      }
      await writeCheckpoint(tx, projector.name, checkpoint);
      if (batch.length < 500) break;
    }
  }
  return applied;
}

// Rebuild = truncate projection tables + reset checkpoint + replay (F17, F28)
export async function rebuildProjection(tx: Tx, name: string): Promise<number> {
  const projector = projectors.find(p => p.name === name);
  if (!projector) throw new Error(`Unknown projection ${name}`);
  await tx.query("select pg_advisory_xact_lock(hashtext('ats:commands'))");
  for (const table of projector.tables) {
    if (table === 'documents') continue;
    if (table === 'org_settings' || table === 'users') {
      // Directory tables are keyed by upsert; clearing users would orphan credentials
      continue;
    }
    await tx.query(`delete from ${table}`);
  }
  await writeCheckpoint(tx, name, 0);
  return runProjections(tx, name);
}

export async function projectionLag(tx: Tx): Promise<Array<{ projection: string; position: number; head: number }>> {
  const { rows } = await tx.query('select coalesce(max(global_position), 0) as head from events');
  const head = Number(rows[0].head);
  const cps = await tx.query('select projection, global_position from projection_checkpoints');
  return projectors.map(p => ({ projection: p.name, position: Number(cps.rows.find(r => r.projection === p.name)?.global_position ?? 0), head }));
}
