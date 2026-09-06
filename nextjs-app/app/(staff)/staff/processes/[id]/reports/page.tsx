'use client';

import { useParams } from 'next/navigation';
import { Shell, useQuery, useI18n } from '@/components/staff/Shell';

type Funnel = Awaited<ReturnType<typeof import('@/lib/queries/reports').funnel>>;
type EE = Awaited<ReturnType<typeof import('@/lib/queries/reports').eeAggregate>>;
type Dash = Awaited<ReturnType<typeof import('@/lib/queries/reports').dashboard>>;
type Sources = Awaited<ReturnType<typeof import('@/lib/queries/reports').sources>>;

export default function Reports() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="reports.title">{me => <View id={id} canEe={me.roles.some(r => ['org_admin', 'hr_advisor'].includes(r))} />}</Shell>;
}

// Charts have an equivalent data table and a text summary (F20, F24)
function View({ id, canEe }: { id: string; canEe: boolean }) {
  const { t, lang, label } = useI18n();
  const funnel = useQuery<Funnel>('funnel', { processId: id });
  const dash = useQuery<Dash>('dashboard', {});
  const sources = useQuery<Sources>('sources', { days: '90' });
  const ee = useQuery<EE>('ee-aggregate', { processId: id });
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${id}`}>{t('back')}</a> · <a href={`/api/queries/funnel.csv?processId=${id}&lang=${lang}`}>{t('reports.funnel_csv')}</a> · <a href={`/api/queries/hires.csv?processId=${id}&lang=${lang}`}>{t('reports.hires_csv')}</a></p>
      {dash.data ? <section className="card mb-3" aria-labelledby="dash"><h2 id="dash" className="font-bold">{t('reports.dashboard')}</h2><p>{t('reports.dash_line', { open: dash.data.openProcesses, recent: dash.data.applicationsLast30Days, days: dash.data.medianTimeToFillDays ?? '—' })} <span className="help">({t('reports.definition')})</span></p></section> : null}
      {funnel.data ? <section className="card mb-3" aria-labelledby="funnel"><h2 id="funnel" className="font-bold">{t('reports.funnel')}</h2>
        <p className="help">{funnel.data.steps.map(s => `${label('funnel', s.label)} ${s.count} (${s.percent} %)`).join(' → ')}</p>
        <div aria-hidden="true">{funnel.data.steps.map(s => <div key={s.label} className="flex items-center gap-2 my-1"><span className="w-28 text-sm">{label('funnel', s.label)}</span><span className="h-5 bg-brand" style={{ width: `${Math.max(2, s.percent)}%` }} /><span className="text-sm">{s.count}</span></div>)}</div>
        <table className="table"><caption className="sr-only">{t('reports.funnel_data')}</caption><thead><tr><th scope="col">{t('reports.step')}</th><th scope="col">{t('reports.count')}</th><th scope="col">{t('reports.percent')}</th></tr></thead><tbody>{funnel.data.steps.map(s => <tr key={s.label}><td>{label('funnel', s.label)}</td><td>{s.count}</td><td>{s.percent} %</td></tr>)}</tbody></table></section> : null}
      {sources.data ? <section className="card mb-3" aria-labelledby="src"><h2 id="src" className="font-bold">{t('reports.sources', { days: sources.data.days })}</h2><table className="table"><caption className="sr-only">{t('reports.source')}</caption><thead><tr><th scope="col">{t('reports.source')}</th><th scope="col">{t('reports.applications')}</th><th scope="col">{t('reports.hires')}</th></tr></thead><tbody>{sources.data.rows.map((r: { source: string; applications: number; hires: number }) => <tr key={r.source}><td>{r.source === 'Direct' ? t('app.direct') : r.source}</td><td>{r.applications}</td><td>{r.hires}</td></tr>)}</tbody></table></section> : null}
      {canEe && ee.data ? <section className="card" aria-labelledby="ee"><h2 id="ee" className="font-bold">{t('reports.ee', { threshold: ee.data.threshold })}</h2><table className="table"><caption className="sr-only">{t('reports.ee_data')}</caption><thead><tr><th scope="col">{t('reports.group')}</th><th scope="col">{t('reports.count')}</th></tr></thead><tbody>{ee.data.groups.map(g => <tr key={g.group}><td>{label('ee', g.group)}</td><td>{g.count}</td></tr>)}</tbody></table><p className="help">{t('reports.ee_note', { declared: ee.data.declared, applications: ee.data.applications, threshold: ee.data.threshold })}</p></section> : null}
    </>
  );
}
