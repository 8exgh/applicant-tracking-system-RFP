'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery } from '@/components/staff/Shell';
import { Field } from '@/components/ui';

type Timeline = Awaited<ReturnType<typeof import('@/lib/queries/staff').timeline>>;

export default function TimelinePage() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="Timeline">{() => <View id={id} />}</Shell>;
}

// Every state change with actor, role, time in the organization's zone, and reason (F17)
function View({ id }: { id: string }) {
  const [category, setCategory] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const { data, error } = useQuery<Timeline>('timeline', { processId: id, ...(category ? { category } : {}), ...(applicationId ? { applicationId } : {}) }, [category, applicationId]);
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${id}`}>Back to process</a> · <a href={`/api/queries/staffing-file?processId=${id}`}>Export staffing file (JSON)</a></p>
      <div className="flex gap-3 flex-wrap">
        <Field id="cat" label="Category"><select id="cat" className="input" value={category} onChange={e => setCategory(e.target.value)}><option value="">All</option>{['process', 'application', 'screening', 'assessment', 'interview', 'offer', 'notification', 'privacy'].map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field id="app" label="Application id"><input id="app" className="input" value={applicationId} onChange={e => setApplicationId(e.target.value)} /></Field>
      </div>
      {error ? <p role="alert" className="field-error">{error}</p> : null}
      {data ? (
        <table className="table"><caption className="sr-only">Timeline entries</caption><thead><tr><th scope="col">When ({data.timeZone})</th><th scope="col">Action</th><th scope="col">Actor</th><th scope="col">Subject</th><th scope="col">Reason / cause</th><th scope="col">Details</th></tr></thead><tbody>
          {data.entries.map(e => <tr key={e.position}><td><time dateTime={e.occurredAt}>{new Date(e.occurredAt).toLocaleString('en-CA', { timeZone: data.timeZone, timeZoneName: 'short' })}</time></td><td>{e.type}<br /><span className="badge">{e.category}</span></td><td>{e.actor.type}{e.actor.id ? `:${String(e.actor.id).slice(0, 8)}` : ''}{e.actor.role ? ` (${e.actor.role})` : ''}</td><td>{e.subject ? (e.subject === 'Candidate (removed)' ? e.subject : <a href={`/staff/applications/${e.applicationId}`}>{String(e.subject).slice(0, 8)}</a>) : '—'}</td><td>{e.reason ?? e.causationId ?? ''}</td><td><details><summary>view</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(e.summary, null, 1)}</pre></details></td></tr>)}
        </tbody></table>
      ) : null}
    </>
  );
}
