import { withTenant } from '@/lib/db/pool';
import { StaffPrincipal, processAccess } from '@/lib/commands/authz';
import { loadOrganization, loadProcess } from '@/lib/app/context';
import { can } from '@/lib/auth/permissions';
import { ForbiddenError } from '@/lib/domain/errors';
import { decryptField, isEnvelope, sha256 } from '@/lib/crypto/pii';
import { readAllForTenant, StoredEvent } from '@/lib/db/event-store';
import { accessLog } from '@/lib/security';
import { now } from '@/lib/clock';
import { Tx } from '@/lib/db/pool';

async function decryptDeep(tx: Tx, tenantId: string, value: unknown): Promise<unknown> {
  if (isEnvelope(value)) { const v = await decryptField(tx, tenantId, value); return v === null ? '[removed]' : v; }
  if (Array.isArray(value)) return Promise.all(value.map(v => decryptDeep(tx, tenantId, v)));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([k, v]) => [k, await decryptDeep(tx, tenantId, v)])));
  return value;
}

function serialize(e: StoredEvent, payload: unknown) {
  return { globalPosition: e.globalPosition, stream: e.streamId, version: e.streamVersion, type: e.type, schemaVersion: e.schemaVersion, occurredAt: e.occurredAt.toISOString(), metadata: e.metadata, payload };
}

// Staffing file (F17): every event about the process and its applications,
// decrypted where keys exist, excluding self-declaration and accommodation
// content, plus a manifest of document hashes.
export async function staffingFile(staff: StaffPrincipal, processId: string, onlyApplicationId?: string) {
  if (!can(staff.roles, 'staffing_file.export')) throw new ForbiddenError();
  return withTenant(staff.tenantId, async tx => {
    const { state: process } = await loadProcess(tx, staff.tenantId, processId);
    processAccess(staff, process);
    const org = await loadOrganization(tx, staff.tenantId);
    const apps = (await tx.query('select id, candidate_id from application_summary where tenant_id = $1 and process_id = $2', [staff.tenantId, processId])).rows
      .filter(r => !onlyApplicationId || r.id === onlyApplicationId);
    const appIds = new Set(apps.map(a => a.id));
    const all = await readAllForTenant(tx, staff.tenantId);
    const relevant = all.filter(e => {
      if (e.streamId === `process-${processId}`) return !onlyApplicationId;
      const [kind, ...rest] = e.streamId.split('-');
      const id = rest.join('-');
      if (kind === 'application') return appIds.has(id);
      if (kind === 'notification') return appIds.has((e.payload as { applicationId?: string }).applicationId ?? '');
      return false; // selfdeclaration-* and accommodation-* are excluded by design
    });
    const events = [];
    for (const e of relevant) events.push(serialize(e, await decryptDeep(tx, staff.tenantId, e.payload)));
    const candidates: Record<string, unknown> = {};
    for (const a of apps) {
      const c = (await tx.query('select email_enc, profile_enc, status from candidates where tenant_id = $1 and id = $2', [staff.tenantId, a.candidate_id])).rows[0];
      candidates[a.candidate_id] = c?.status === 'Removed' ? { removed: true } : { email: await decryptField(tx, staff.tenantId, c?.email_enc), profile: await decryptField(tx, staff.tenantId, c?.profile_enc) };
    }
    const docs = (await tx.query('select id, application_id, sha256, size, mime, scan_status, removed from documents where tenant_id = $1 and application_id = any($2)', [staff.tenantId, Array.from(appIds)])).rows;
    await accessLog(tx, { tenantId: staff.tenantId, actorType: 'staff', actorId: staff.userId, resource: onlyApplicationId ? 'candidate_record' : 'staffing_file', subjectId: onlyApplicationId ?? processId, purpose: 'export' });
    const body = {
      organization: { name: org.name, slug: org.slug, timeZone: org.timeZone },
      process: { id: process.id, reference: process.reference, title: process.title, status: process.status, criteria: process.criteria, plan: process.plan, rubrics: process.rubrics, stages: process.stages, posterVersions: process.posterHistory },
      applications: apps.map(a => ({ applicationId: a.id, candidateId: a.candidate_id })),
      candidates, events,
      documents: docs.map(d => ({ documentId: d.id, applicationId: d.application_id, sha256: d.sha256, size: d.size, mime: d.mime, scanStatus: d.scan_status, removed: d.removed })),
      exportedAt: now().toISOString(), exportedBy: staff.userId, excludes: ['self-declaration', 'accommodation requests']
    };
    const json = JSON.stringify(body, null, 2);
    return { body, manifest: { 'staffing-file.json': sha256(json), documents: Object.fromEntries(docs.map(d => [d.id, d.sha256])) } };
  });
}

// Tenant export (F23): all events (decrypted where keys still exist), plus a schema description
export async function tenantExport(staff: StaffPrincipal) {
  if (!can(staff.roles, 'org.export')) throw new ForbiddenError();
  return withTenant(staff.tenantId, async tx => {
    const all = await readAllForTenant(tx, staff.tenantId);
    const events = [];
    for (const e of all) events.push(serialize(e, await decryptDeep(tx, staff.tenantId, e.payload)));
    const tables: Record<string, unknown[]> = {};
    for (const t of ['process_summary', 'application_summary', 'candidates', 'interview_slots', 'notification_queue', 'notification_templates', 'audit_timeline']) {
      tables[t] = (await tx.query(`select * from ${t} where tenant_id = $1`, [staff.tenantId])).rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !k.endsWith('_enc'))));
    }
    await accessLog(tx, { tenantId: staff.tenantId, actorType: 'staff', actorId: staff.userId, resource: 'tenant_export', purpose: 'export' });
    return { schema: { events: 'append-only event store rows, payload decrypted where the data key exists', tables: Object.keys(tables) }, events, tables, exportedAt: now().toISOString() };
  });
}
