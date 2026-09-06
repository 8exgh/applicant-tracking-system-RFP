'use client';

import { Shell, useQuery, useI18n, pick } from '@/components/staff/Shell';

interface Row { processId: string; reference: string; title: Record<string, string>; status: string; location: string; closeAt: string | null; applications: Record<string, number>; }

export default function Processes() {
  return (
    <Shell title="processes.title">
      {me => <List canCreate={me.roles.some(r => ['org_admin', 'hr_advisor', 'hiring_manager'].includes(r))} tz={me.org.timeZone} />}
    </Shell>
  );
}

function List({ canCreate, tz }: { canCreate: boolean; tz: string }) {
  const { t, lang, label, fmt } = useI18n();
  const { data, error } = useQuery<Row[]>('processes', {});
  return (
    <>
      {canCreate ? <p className="mb-4"><a href="/staff/processes/new" className="btn-primary">{t('processes.new')}</a></p> : null}
      {error ? <p role="alert" className="field-error">{error}</p> : null}
      {data ? (
        <table className="table">
          <caption className="sr-only">{t('processes.title')}</caption>
          <thead><tr><th scope="col">{t('processes.reference')}</th><th scope="col">{t('processes.process')}</th><th scope="col">{t('processes.status')}</th><th scope="col">{t('processes.closes')}</th><th scope="col">{t('processes.applications')}</th></tr></thead>
          <tbody>
            {data.map(p => (
              <tr key={p.processId}>
                <td><a href={`/staff/processes/${p.processId}`}>{p.reference}</a></td>
                <td>{pick(p.title, lang)}</td>
                <td><span className="badge">{label('ps', p.status)}</span></td>
                <td>{p.closeAt ? fmt(p.closeAt, tz) : '—'}</td>
                <td>{Object.entries(p.applications).map(([k, v]) => `${label('as', k)} ${v}`).join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
