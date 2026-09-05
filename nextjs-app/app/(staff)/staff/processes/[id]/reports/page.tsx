'use client';

import { useParams } from 'next/navigation';
import { Shell, useQuery } from '@/components/staff/Shell';

type Funnel = Awaited<ReturnType<typeof import('@/lib/queries/reports').funnel>>;
type EE = Awaited<ReturnType<typeof import('@/lib/queries/reports').eeAggregate>>;
type Dash = Awaited<ReturnType<typeof import('@/lib/queries/reports').dashboard>>;
type Sources = Awaited<ReturnType<typeof import('@/lib/queries/reports').sources>>;

export default function Reports() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="Reports">{me => <View id={id} canEe={me.roles.some(r => ['org_admin', 'hr_advisor'].includes(r))} />}</Shell>;
}

// Charts have an equivalent data table and a text summary (F20, F24)
function View({ id, canEe }: { id: string; canEe: boolean }) {
  const funnel = useQuery<Funnel>('funnel', { processId: id });
  const dash = useQuery<Dash>('dashboard', {});
  const sources = useQuery<Sources>('sources', { days: '90' });
  const ee = useQuery<EE>('ee-aggregate', { processId: id });
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${id}`}>Back to process</a> · <a href={`/api/queries/funnel.csv?processId=${id}`}>Funnel CSV</a> · <a href={`/api/queries/hires.csv?processId=${id}`}>Hires CSV</a></p>
      {dash.data ? <section className="card mb-3" aria-labelledby="dash"><h2 id="dash" className="font-bold">Dashboard</h2><p>Open processes {dash.data.openProcesses} · applications last 30 days {dash.data.applicationsLast30Days} · median time-to-fill {dash.data.medianTimeToFillDays ?? '—'} days <span className="help">({dash.data.definition})</span></p></section> : null}
      {funnel.data ? <section className="card mb-3" aria-labelledby="funnel"><h2 id="funnel" className="font-bold">Funnel</h2>
        <p className="help">{funnel.data.steps.map(s => `${s.label} ${s.count} (${s.percent}%)`).join(' → ')}</p>
        <div aria-hidden="true">{funnel.data.steps.map(s => <div key={s.label} className="flex items-center gap-2 my-1"><span className="w-28 text-sm">{s.label}</span><span className="h-5 bg-brand" style={{ width: `${Math.max(2, s.percent)}%` }} /><span className="text-sm">{s.count}</span></div>)}</div>
        <table className="table"><caption className="sr-only">Funnel data</caption><thead><tr><th scope="col">Step</th><th scope="col">Count</th><th scope="col">Percent</th></tr></thead><tbody>{funnel.data.steps.map(s => <tr key={s.label}><td>{s.label}</td><td>{s.count}</td><td>{s.percent}%</td></tr>)}</tbody></table></section> : null}
      {sources.data ? <section className="card mb-3" aria-labelledby="src"><h2 id="src" className="font-bold">Sources (last {sources.data.days} days)</h2><table className="table"><caption className="sr-only">Sources</caption><thead><tr><th scope="col">Source</th><th scope="col">Applications</th><th scope="col">Hires</th></tr></thead><tbody>{sources.data.rows.map((r: { source: string; applications: number; hires: number }) => <tr key={r.source}><td>{r.source}</td><td>{r.applications}</td><td>{r.hires}</td></tr>)}</tbody></table></section> : null}
      {canEe && ee.data ? <section className="card" aria-labelledby="ee"><h2 id="ee" className="font-bold">Employment equity (aggregate, suppression threshold {ee.data.threshold})</h2><table className="table"><caption className="sr-only">Employment equity aggregates</caption><thead><tr><th scope="col">Group</th><th scope="col">Count</th></tr></thead><tbody>{ee.data.groups.map(g => <tr key={g.group}><td>{g.group}</td><td>{g.count}</td></tr>)}</tbody></table><p className="help">Declared: {ee.data.declared} of {ee.data.applications} applications. Counts below the threshold show as &lt;{ee.data.threshold} and totals are withheld so they cannot be derived.</p></section> : null}
    </>
  );
}
