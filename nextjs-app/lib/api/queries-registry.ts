import { NextResponse } from 'next/server';
import { HandlerContext } from './handler';
import { requireStaff, requireCandidate, requireApi, requirePlatform } from '@/lib/commands/authz';
import * as staffQ from '@/lib/queries/staff';
import * as candQ from '@/lib/queries/candidate';
import * as reports from '@/lib/queries/reports';
import * as exportsQ from '@/lib/queries/exports';
import { notificationsToSend } from '@/lib/commands/notification';
import { lag, projectionNames } from '@/lib/commands/ops';
import { withPlatform, withTenant } from '@/lib/db/pool';
import { DomainError } from '@/lib/domain/errors';
import { buildCandidateExport } from '@/lib/commands/candidate';
import { loadOrganization } from '@/lib/app/context';
import { getPool } from '@/lib/db/pool';

type Q = (ctx: HandlerContext<unknown>) => Promise<unknown>;
const p = (ctx: HandlerContext<unknown>, name: string): string | undefined => ctx.request.nextUrl.searchParams.get(name) ?? undefined;
const need = (ctx: HandlerContext<unknown>, name: string): string => { const v = p(ctx, name); if (!v) throw new DomainError('missing_parameter', `Missing ${name}`, undefined, 400); return v; };

export const queries: Record<string, Q> = {
  // ---- session ----
  'me': async ctx => {
    if (!ctx.principal) throw new DomainError('unauthorized', undefined, undefined, 401);
    if (ctx.principal.kind === 'staff') {
      const staff = ctx.principal;
      const org = await withTenant(staff.tenantId, tx => loadOrganization(tx, staff.tenantId));
      return { kind: 'staff', userId: staff.userId, tenantId: staff.tenantId, roles: staff.roles, displayName: staff.displayName, language: staff.language, email: staff.email, org: { name: org.name, slug: org.slug, timeZone: org.timeZone, languages: org.languages, settings: org.settings, branding: org.branding, featureFlags: org.featureFlags }, users: Object.values(org.users).map(u => ({ userId: u.userId, displayName: u.displayName || u.email, roles: u.roles, status: u.status })) };
    }
    if (ctx.principal.kind === 'candidate') return { kind: 'candidate', ...(await candQ.myProfile(ctx.principal.tenantId, ctx.principal.candidateId)) };
    if (ctx.principal.kind === 'platform') return { kind: 'platform', operatorId: ctx.principal.operatorId };
    return { kind: 'api' };
  },

  // ---- platform ----
  'organizations': async ctx => { requirePlatform(ctx.principal); return withPlatform(async tx => (await tx.query('select tenant_id, slug, name, time_zone, languages, status, feature_flags, created_at from org_settings order by created_at desc')).rows); },
  'platform-health': async ctx => {
    if (!ctx.principal || (ctx.principal.kind !== 'platform' && ctx.principal.kind !== 'api')) throw new DomainError('unauthorized', undefined, undefined, 401);
    const lags = await lag();
    const queue = await withPlatform(async tx => (await tx.query("select status, count(*)::int as n from notification_queue group by status")).rows);
    return { projections: lags, notificationQueue: queue, projectionNames };
  },

  // ---- staff ----
  'processes': async ctx => staffQ.listProcesses(requireStaff(ctx.principal, 'process.view')),
  'process': async ctx => staffQ.processDetail(requireStaff(ctx.principal, 'process.view'), need(ctx, 'processId')),
  'pipeline-board': async ctx => staffQ.pipelineBoard(requireStaff(ctx.principal, 'process.view'), need(ctx, 'processId'), { source: p(ctx, 'source'), tag: p(ctx, 'tag') }),
  'screening-worklist': async ctx => staffQ.screeningWorklist(requireStaff(ctx.principal, 'application.screen'), need(ctx, 'processId')),
  'application': async ctx => staffQ.applicationDetail(requireStaff(ctx.principal, 'application.view'), need(ctx, 'applicationId')),
  'assessment-workbook': async ctx => staffQ.assessmentWorkbook(requireStaff(ctx.principal, 'process.view'), need(ctx, 'processId')),
  'timeline': async ctx => staffQ.timeline(requireStaff(ctx.principal, 'timeline.view'), { processId: p(ctx, 'processId'), applicationId: p(ctx, 'applicationId'), category: p(ctx, 'category'), candidateId: p(ctx, 'candidateId') }),
  'interview-slots': async ctx => staffQ.interviewSlots(requireStaff(ctx.principal, 'process.view'), need(ctx, 'processId')),
  'accommodations': async ctx => staffQ.hrAccommodations(requireStaff(ctx.principal, 'accommodation.view'), need(ctx, 'processId')),
  'organization-settings': async ctx => staffQ.orgSettingsView(requireStaff(ctx.principal, 'process.view')),
  'notification-log': async ctx => {
    const staff = requireStaff(ctx.principal, 'process.view');
    return withTenant(staff.tenantId, async tx => (await tx.query('select id, template_key, lang, recipient_kind, status, attempts, last_error, fallback, queued_at, sent_at from notification_queue where tenant_id = $1 order by queued_at desc limit 200', [staff.tenantId])).rows);
  },
  'security-log': async ctx => {
    const staff = requireStaff(ctx.principal, 'org.settings');
    return withPlatform(async tx => (await tx.query('select kind, actor_id, resource, detail, occurred_at from security_log where tenant_id = $1 order by occurred_at desc limit 200', [staff.tenantId])).rows);
  },
  'access-log': async ctx => {
    const staff = requireStaff(ctx.principal, 'org.settings');
    return withPlatform(async tx => (await tx.query('select actor_type, actor_id, resource, subject_id, purpose, reason, occurred_at from access_log where tenant_id = $1 order by occurred_at desc limit 200', [staff.tenantId])).rows);
  },

  // ---- reports ----
  'dashboard': async ctx => reports.dashboard(requireStaff(ctx.principal, 'reports.view')),
  'funnel': async ctx => reports.funnel(requireStaff(ctx.principal, 'reports.view'), need(ctx, 'processId')),
  'sources': async ctx => reports.sources(requireStaff(ctx.principal, 'reports.view'), parseInt(p(ctx, 'days') ?? '90', 10)),
  'ee-aggregate': async ctx => reports.eeAggregate(requireStaff(ctx.principal, 'ee.aggregate'), need(ctx, 'processId')),
  'funnel.csv': async ctx => {
    const f = await reports.funnel(requireStaff(ctx.principal, 'reports.view'), need(ctx, 'processId'));
    const lang = p(ctx, 'lang') === 'fr' ? 'fr' : 'en';
    const headers = lang === 'fr' ? ['étape', 'nombre', 'pourcentage'] : ['step', 'count', 'percent'];
    const rows = f.steps.map(s => ({ [headers[0]]: s.label, [headers[1]]: s.count, [headers[2]]: s.percent }));
    return new NextResponse(reports.csv(rows, headers), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="funnel-${f.reference}.csv"` } });
  },
  'hires.csv': async ctx => {
    const staff = requireStaff(ctx.principal, 'reports.view');
    const processId = need(ctx, 'processId');
    const rows = await withTenant(staff.tenantId, async tx => {
      const { rows } = await tx.query('select a.id, a.candidate_id, a.hired_at, p.reference from application_summary a join process_summary p on p.id = a.process_id where a.tenant_id = $1 and a.process_id = $2 and a.hired_at is not null', [staff.tenantId, processId]);
      const out = [];
      const { decryptField } = await import('@/lib/crypto/pii');
      const { loadApplication } = await import('@/lib/app/context');
      const { currentOffer } = await import('@/lib/domain/application');
      for (const r of rows) {
        const cand = (await tx.query('select profile_enc from candidates where tenant_id = $1 and id = $2', [staff.tenantId, r.candidate_id])).rows[0];
        const profile = (await decryptField<{ name?: string }>(tx, staff.tenantId, cand?.profile_enc)) ?? {};
        const { state } = await loadApplication(tx, staff.tenantId, r.id);
        const offer = currentOffer(state);
        const fields = (await decryptField<{ position?: string; startDate?: string }>(tx, staff.tenantId, offer?.fields as never)) ?? {};
        out.push({ name: profile.name ?? '', position: fields.position ?? '', start_date: fields.startDate ?? '', hired_at: new Date(r.hired_at).toISOString(), reference: r.reference });
      }
      const { accessLog } = await import('@/lib/security');
      await accessLog(tx, { tenantId: staff.tenantId, actorType: 'staff', actorId: staff.userId, resource: 'hires_export', subjectId: processId, purpose: 'export' });
      return out;
    });
    return new NextResponse(reports.csv(rows, ['name', 'position', 'start_date', 'hired_at', 'reference']), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="hires.csv"' } });
  },

  // ---- exports ----
  'staffing-file': async ctx => exportsQ.staffingFile(requireStaff(ctx.principal, 'staffing_file.export'), need(ctx, 'processId'), p(ctx, 'applicationId')),
  'tenant-export': async ctx => exportsQ.tenantExport(requireStaff(ctx.principal, 'org.export')),

  // ---- candidate ----
  'my-applications': async ctx => { const c = requireCandidate(ctx.principal); return candQ.myApplications(c.tenantId, c.candidateId, c.locale); },
  'application-form': async ctx => { const c = requireCandidate(ctx.principal); await candQ.logCandidateSelfRead(c.tenantId, c.candidateId, 'application'); return candQ.applicationForm(c.tenantId, c.candidateId, need(ctx, 'applicationId'), c.locale); },
  'candidate-slots': async ctx => { const c = requireCandidate(ctx.principal); return candQ.candidateSlots(c.tenantId, c.candidateId, need(ctx, 'applicationId')); },
  'my-data-export': async ctx => { const c = requireCandidate(ctx.principal); await candQ.logCandidateSelfRead(c.tenantId, c.candidateId, 'data_export'); return withTenant(c.tenantId, tx => buildCandidateExport(tx, c.tenantId, c.candidateId)); },

  // ---- processor todo lists (API key) ----
  'notifications-to-send': async ctx => { requireApi(ctx.principal); return notificationsToSend(parseInt(p(ctx, 'limit') ?? '50', 10)); },
  'documents-to-scan': async ctx => { requireApi(ctx.principal); return staffQ.applicationsToScan(); },
  'document-bytes': async ctx => {
    requireApi(ctx.principal);
    const content = await staffQ.documentBytesForScan(need(ctx, 'tenantId'), need(ctx, 'documentId'));
    if (!content) throw new DomainError('document_not_found', undefined, undefined, 404);
    return new NextResponse(new Uint8Array(content), { headers: { 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } });
  },
  'db-ping': async () => { await getPool().query('select 1'); return { ok: true }; }
};
