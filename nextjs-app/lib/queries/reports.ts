import { withTenant } from '@/lib/db/pool';
import { StaffPrincipal, processAccess } from '@/lib/commands/authz';
import { loadOrganization, loadProcess } from '@/lib/app/context';
import { can } from '@/lib/auth/permissions';
import { ForbiddenError } from '@/lib/domain/errors';
import { decryptField } from '@/lib/crypto/pii';
import { accessLog } from '@/lib/security';
import { daysBetween } from '@/lib/i18n/format';
import { now } from '@/lib/clock';

export const EE_GROUPS = ['women', 'indigenous_peoples', 'persons_with_disabilities', 'visible_minorities'] as const;

export async function dashboard(staff: StaffPrincipal) {
  if (!can(staff.roles, 'reports.view')) throw new ForbiddenError();
  return withTenant(staff.tenantId, async tx => {
    const at = now();
    const open = (await tx.query("select count(*)::int as n from process_summary where tenant_id = $1 and status in ('Posted', 'Scheduled', 'Closed')", [staff.tenantId])).rows[0].n;
    const byStage = (await tx.query("select stage, count(*)::int as n from application_summary where tenant_id = $1 and status = 'Active' group by stage", [staff.tenantId])).rows;
    const last30 = (await tx.query("select count(*)::int as n from application_summary where tenant_id = $1 and submitted_at > $2", [staff.tenantId, new Date(at.getTime() - 30 * 86_400_000)])).rows[0].n;
    // Time-to-fill: posting published → offer accepted (F20)
    const { rows: fills } = await tx.query(
      `select p.published_at, a.hired_at from application_summary a join process_summary p on p.id = a.process_id
       where a.tenant_id = $1 and a.hired_at is not null and p.published_at is not null and a.hired_at > $2`, [staff.tenantId, new Date(at.getTime() - 365 * 86_400_000)]
    );
    const days = fills.map(f => daysBetween(f.published_at, f.hired_at)).sort((a, b) => a - b);
    const median = days.length ? days[Math.floor(days.length / 2)] : null;
    return { openProcesses: open, applicationsByStage: byStage, applicationsLast30Days: last30, medianTimeToFillDays: median, definition: 'Time-to-fill = days from posting publication to offer acceptance', generatedAt: at.toISOString() };
  });
}

export async function funnel(staff: StaffPrincipal, processId: string) {
  if (!can(staff.roles, 'reports.view')) throw new ForbiddenError();
  return withTenant(staff.tenantId, async tx => {
    const { state } = await loadProcess(tx, staff.tenantId, processId);
    processAccess(staff, state);
    const { rows } = await tx.query('select status, stage, qualified, hired_at from application_summary where tenant_id = $1 and process_id = $2', [staff.tenantId, processId]);
    const applied = rows.filter(r => r.status !== 'Draft').length;
    const screenedIn = rows.filter(r => ['Active', 'NotQualified', 'Hired'].includes(r.status)).length;
    const interviewed = (await tx.query("select count(distinct application_id)::int as n from audit_timeline where tenant_id = $1 and process_id = $2 and event_type = 'InterviewBooked'", [staff.tenantId, processId])).rows[0].n;
    const qualified = rows.filter(r => r.qualified === true).length;
    const hired = rows.filter(r => r.hired_at).length;
    const pct = (n: number) => applied ? Math.round((n / applied) * 1000) / 10 : 0;
    return { processId, reference: state.reference, steps: [
      { label: 'Applied', count: applied, percent: 100 }, { label: 'Screened in', count: screenedIn, percent: pct(screenedIn) },
      { label: 'Interviewed', count: interviewed, percent: pct(interviewed) }, { label: 'Qualified', count: qualified, percent: pct(qualified) }, { label: 'Hired', count: hired, percent: pct(hired) }
    ] };
  });
}

export async function sources(staff: StaffPrincipal, days = 90) {
  if (!can(staff.roles, 'reports.view')) throw new ForbiddenError();
  return withTenant(staff.tenantId, async tx => {
    const since = new Date(now().getTime() - days * 86_400_000);
    const { rows } = await tx.query(
      `select coalesce(source->>'source', 'Direct') as source, count(*)::int as applications, count(hired_at)::int as hires
       from application_summary where tenant_id = $1 and submitted_at > $2 group by 1 order by applications desc`, [staff.tenantId, since]
    );
    return { days, rows };
  });
}

// Employment-equity aggregates with suppression (F08, F20): counts below the
// threshold show as "<N" and totals are withheld so nothing can be derived.
export async function eeAggregate(staff: StaffPrincipal, processId: string) {
  if (!can(staff.roles, 'ee.aggregate')) throw new ForbiddenError();
  return withTenant(staff.tenantId, async tx => {
    const org = await loadOrganization(tx, staff.tenantId);
    const { state } = await loadProcess(tx, staff.tenantId, processId);
    processAccess(staff, state);
    const threshold = org.settings.suppressionThreshold;
    const { rows } = await tx.query('select groups_enc from ee_declarations where tenant_id = $1 and process_id = $2 and not withdrawn', [staff.tenantId, processId]);
    const counts: Record<string, number> = Object.fromEntries(EE_GROUPS.map(g => [g, 0]));
    for (const r of rows) {
      const groups = (await decryptField<string[]>(tx, staff.tenantId, r.groups_enc)) ?? [];
      for (const g of groups) if (g in counts) counts[g]++;
    }
    await accessLog(tx, { tenantId: staff.tenantId, actorType: 'staff', actorId: staff.userId, resource: 'ee_aggregate', subjectId: processId, purpose: 'report' });
    const applications = (await tx.query("select count(*)::int as n from application_summary where tenant_id = $1 and process_id = $2 and status <> 'Draft'", [staff.tenantId, processId])).rows[0].n;
    const suppressed = Object.values(counts).some(n => n > 0 && n < threshold);
    return {
      processId, threshold, applications,
      groups: EE_GROUPS.map(g => ({ group: g, count: counts[g] === 0 ? '0' : counts[g] < threshold ? `<${threshold}` : String(counts[g]) })),
      declared: suppressed ? 'suppressed' : String(rows.length)
    };
  });
}

export function csv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '\uFEFF' + [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}
