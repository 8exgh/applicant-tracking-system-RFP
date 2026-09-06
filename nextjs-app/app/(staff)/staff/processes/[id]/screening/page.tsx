'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery, Status, useI18n } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';

type Worklist = Awaited<ReturnType<typeof import('@/lib/queries/staff').screeningWorklist>>;
type Detail = Awaited<ReturnType<typeof import('@/lib/queries/staff').processDetail>>;

export default function Screening() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="screening.title">{() => <Worklist id={id} />}</Shell>;
}

function Worklist({ id }: { id: string }) {
  const { t } = useI18n();
  const { data, error, reload } = useQuery<Worklist>('screening-worklist', { processId: id });
  const { data: process } = useQuery<Detail>('process', { processId: id });
  const essentials = (process?.criteria ?? []).filter(c => c.type === 'essential').map(c => c.code);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [rationale, setRationale] = useState('');
  const [unmet, setUnmet] = useState('');
  if (error) return <p role="alert" className="field-error">{error}</p>;
  if (!data) return <p role="status">{t('loading')}</p>;
  const bulk = async () => {
    const code = unmet || essentials[0];
    const marks = Object.fromEntries(essentials.map(c => [c, c === code ? 'not_met' : 'met']));
    try { const r = await staffApi.command('bulk-screen-out', { applicationIds: selected, marks, rationale }); setStatus(t('screening.bulk_done', { n: r.results.length, id: r.correlationId.slice(0, 8) })); setSelected([]); reload(); } catch (e) { setStatus(errorMessage(e)); }
  };
  const release = async () => { try { const r = await staffApi.command('release-screening-results', { processId: id }); setStatus(t('screening.released', { counts: JSON.stringify(r.counts) })); reload(); } catch (e) { setStatus(errorMessage(e)); } };
  const g = data.groups;
  const Group = ({ title, cards }: { title: string; cards: Worklist['cards'] }) => (
    <section className="card mb-3" aria-labelledby={title}><h2 id={title} className="font-bold mb-2">{title} ({cards.length})</h2>
      <ul className="list-none p-0 m-0">{cards.map(c => <li key={c.applicationId} className="flex items-center gap-2 py-1">{c.status === 'Submitted' ? <input type="checkbox" className="h-5 w-5" aria-label={t('screening.select', { name: c.name })} checked={selected.includes(c.applicationId)} onChange={e => setSelected(s => e.target.checked ? [...s, c.applicationId] : s.filter(x => x !== c.applicationId))} /> : null}<a href={`/staff/applications/${c.applicationId}`}>{c.name}</a>{c.screening?.automatic ? <span className="badge">{t('screening.automatic', { code: c.screening.knockoutCode ?? '' })}</span> : null}</li>)}</ul>
    </section>
  );
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${id}`}>{data.reference}</a> · {data.screeningOpen ? t('screening.open') : t('screening.not_open')} · {t('screening.summary', { in: g.screenedIn.length, out: g.screenedOut.length, withdrawn: g.withdrawn.length, pending: g.notScreened.length })}</p>
      <Status message={status} />
      <Group title={t('screening.not_screened')} cards={g.notScreened} />
      {selected.length ? <div className="card mb-3"><label htmlFor="bulk-unmet" className="label">{t('editor.criterion')} ({t('app.not_met')})</label><select id="bulk-unmet" className="input" value={unmet || essentials[0] || ''} onChange={e => setUnmet(e.target.value)}>{essentials.map(c => <option key={c}>{c}</option>)}</select><label htmlFor="bulk-rationale" className="label mt-2">{t('screening.bulk_rationale', { n: selected.length })}</label><input id="bulk-rationale" className="input" value={rationale} onChange={e => setRationale(e.target.value)} /><button className="btn-danger mt-2" onClick={bulk}>{t('screening.bulk')}</button></div> : null}
      <Group title={t('screening.in')} cards={g.screenedIn} />
      <Group title={t('screening.out')} cards={g.screenedOut} />
      <Group title={t('screening.withdrawn')} cards={g.withdrawn} />
      <button className="btn-primary" onClick={release}>{t('editor.release')}</button>
    </>
  );
}
