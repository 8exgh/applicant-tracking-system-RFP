'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery, Status } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { Field } from '@/components/ui';

type Board = Awaited<ReturnType<typeof import('@/lib/queries/staff').pipelineBoard>>;

export default function Pipeline() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="Pipeline board">{() => <BoardView id={id} />}</Shell>;
}

// Keyboard-operable kanban: select a card, move it with the buttons, moves are announced (F10, F24)
function BoardView({ id }: { id: string }) {
  const [filters, setFilters] = useState({ source: '', tag: '' });
  const { data, error, reload } = useQuery<Board>('pipeline-board', { processId: id, ...(filters.source ? { source: filters.source } : {}), ...(filters.tag ? { tag: filters.tag } : {}) }, [filters]);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  if (error) return <p role="alert" className="field-error">{error}</p>;
  if (!data) return <p role="status">Loading…</p>;
  const move = async (applicationId: string, to: string, name: string) => {
    try { await staffApi.command('move-to-stage', { applicationId, to, reason: reason || undefined }); setStatus(`${name} moved to ${to}`); reload(); } catch (e) { setStatus(errorMessage(e)); }
  };
  const columns = data.stages;
  const inactive = data.cards.filter(c => ['ScreenedOut', 'Withdrawn', 'NotQualified'].includes(c.status));
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${id}`}>{data.reference}</a> · {data.title.en} · <span className="badge">{data.status}</span></p>
      <div className="flex flex-wrap gap-3 items-end mb-3">
        <Field id="f-source" label="Filter by source"><input id="f-source" className="input" value={filters.source} onChange={e => setFilters(f => ({ ...f, source: e.target.value }))} /></Field>
        <Field id="f-tag" label="Filter by tag"><input id="f-tag" className="input" value={filters.tag} onChange={e => setFilters(f => ({ ...f, tag: e.target.value }))} /></Field>
        <Field id="move-reason" label="Reason (required for backward moves)"><input id="move-reason" className="input" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      </div>
      <Status message={status} />
      <div className="overflow-x-auto">
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(14rem, 1fr))` }}>
          {columns.map(col => {
            const cards = data.cards.filter(c => c.stage === col.stageId && ['Submitted', 'Active', 'Hired'].includes(c.status));
            return (
              <section key={col.stageId} aria-labelledby={`col-${col.stageId}`} className="card">
                <h2 id={`col-${col.stageId}`} className="font-bold mb-2">{col.name.en} <span className="badge">{cards.length}</span></h2>
                <ul className="list-none p-0 m-0 grid gap-2">
                  {cards.map(c => (
                    <li key={c.applicationId} className="border rounded p-2 bg-gray-50">
                      <a href={`/staff/applications/${c.applicationId}`} className="font-semibold">{c.name}</a>
                      <p className="text-xs text-gray-700">{c.status}{c.daysInStage !== null ? ` · ${c.daysInStage} days in stage` : ''}{c.qualified ? ' · qualified' : ''}{c.emailBounced ? ' · Email undeliverable' : ''}</p>
                      {c.tags.length ? <p className="text-xs">{(c.tags as string[]).map(t => <span key={t} className="badge mr-1">{t}</span>)}</p> : null}
                      {c.status === 'Active' ? (
                        <div className="flex gap-1 mt-1">
                          {columns.map(target => target.stageId !== col.stageId && !['hired'].includes(target.stageId) ? <button key={target.stageId} type="button" className="btn-secondary !min-h-[32px] !py-0 text-xs" onClick={() => move(c.applicationId, target.stageId, c.name)} aria-label={`Move ${c.name} to ${target.name.en}`}>→ {target.name.en}</button> : null)}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <details className="mt-4"><summary className="font-semibold">Screened out, not qualified and withdrawn ({inactive.length})</summary><ul className="list-disc pl-5">{inactive.map(c => <li key={c.applicationId}><a href={`/staff/applications/${c.applicationId}`}>{c.name}</a> — {c.status}{c.screening?.automatic ? ' (automatic)' : ''}</li>)}</ul></details>
    </>
  );
}
