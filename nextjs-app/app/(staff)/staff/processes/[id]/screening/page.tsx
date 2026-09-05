'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery, Status } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';

type Worklist = Awaited<ReturnType<typeof import('@/lib/queries/staff').screeningWorklist>>;

export default function Screening() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="Screening worklist">{() => <Worklist id={id} />}</Shell>;
}

function Worklist({ id }: { id: string }) {
  const { data, error, reload } = useQuery<Worklist>('screening-worklist', { processId: id });
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [rationale, setRationale] = useState('');
  if (error) return <p role="alert" className="field-error">{error}</p>;
  if (!data) return <p role="status">Loading…</p>;
  const bulk = async () => {
    try { const r = await staffApi.command('bulk-screen-out', { applicationIds: selected, marks: Object.fromEntries((data.cards[0] ? [] : []).map(x => [x, 'not_met'])), rationale }); setStatus(`Screened out ${r.results.length} (correlation ${r.correlationId.slice(0, 8)})`); setSelected([]); reload(); } catch (e) { setStatus(errorMessage(e)); }
  };
  const release = async () => { try { const r = await staffApi.command('release-screening-results', { processId: id }); setStatus(`Released: ${JSON.stringify(r.counts)}`); reload(); } catch (e) { setStatus(errorMessage(e)); } };
  const Group = ({ title, cards }: { title: string; cards: Worklist['cards'] }) => (
    <section className="card mb-3" aria-labelledby={title}><h2 id={title} className="font-bold mb-2">{title} ({cards.length})</h2>
      <ul className="list-none p-0 m-0">{cards.map(c => <li key={c.applicationId} className="flex items-center gap-2 py-1">{c.status === 'Submitted' ? <input type="checkbox" className="h-5 w-5" aria-label={`Select ${c.name}`} checked={selected.includes(c.applicationId)} onChange={e => setSelected(s => e.target.checked ? [...s, c.applicationId] : s.filter(x => x !== c.applicationId))} /> : null}<a href={`/staff/applications/${c.applicationId}`}>{c.name}</a>{c.screening?.automatic ? <span className="badge">automatic {c.screening.knockoutCode}</span> : null}</li>)}</ul>
    </section>
  );
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${id}`}>{data.reference}</a> · {data.screeningOpen ? 'Screening open' : 'Screening not open'} · {data.summary}</p>
      <Status message={status} />
      <Group title="Not screened" cards={data.groups.notScreened} />
      {selected.length ? <div className="card mb-3"><label htmlFor="bulk-rationale" className="label">Rationale for bulk screen-out ({selected.length} selected)</label><input id="bulk-rationale" className="input" value={rationale} onChange={e => setRationale(e.target.value)} /><button className="btn-danger mt-2" onClick={bulk}>Screen out selected</button></div> : null}
      <Group title="Screened in" cards={data.groups.screenedIn} />
      <Group title="Screened out" cards={data.groups.screenedOut} />
      <Group title="Withdrawn" cards={data.groups.withdrawn} />
      <button className="btn-primary" onClick={release}>Release screening results</button>
    </>
  );
}
