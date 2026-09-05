'use client';

import { Shell, useQuery } from '@/components/staff/Shell';

interface Row { processId: string; reference: string; title: Record<string, string>; status: string; location: string; closeAt: string | null; applications: Record<string, number>; }

export default function Processes() {
  return (
    <Shell title="Hiring processes">
      {me => <List canCreate={me.roles.some(r => ['org_admin', 'hr_advisor', 'hiring_manager'].includes(r))} tz={me.org.timeZone} />}
    </Shell>
  );
}

function List({ canCreate, tz }: { canCreate: boolean; tz: string }) {
  const { data, error } = useQuery<Row[]>('processes', {});
  return (
    <>
      {canCreate ? <p className="mb-4"><a href="/staff/processes/new" className="btn-primary">New process</a></p> : null}
      {error ? <p role="alert" className="field-error">{error}</p> : null}
      {data ? (
        <table className="table">
          <caption className="sr-only">Hiring processes</caption>
          <thead><tr><th scope="col">Reference</th><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Closes</th><th scope="col">Applications</th></tr></thead>
          <tbody>
            {data.map(p => (
              <tr key={p.processId}>
                <td><a href={`/staff/processes/${p.processId}`}>{p.reference}</a></td>
                <td>{p.title.en || p.title.fr}</td>
                <td><span className="badge">{p.status}</span></td>
                <td>{p.closeAt ? new Date(p.closeAt).toLocaleString('en-CA', { timeZone: tz, timeZoneName: 'short' }) : '—'}</td>
                <td>{Object.entries(p.applications).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
