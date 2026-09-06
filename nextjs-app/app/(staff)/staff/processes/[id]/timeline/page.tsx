'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery, useI18n } from '@/components/staff/Shell';
import { Field } from '@/components/ui';

type Timeline = Awaited<ReturnType<typeof import('@/lib/queries/staff').timeline>>;

export default function TimelinePage() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="timeline.title">{() => <View id={id} />}</Shell>;
}

// Every state change with actor, role, time in the organization's zone, and reason (F17)
function View({ id }: { id: string }) {
  const { t, label, fmt } = useI18n();
  const [category, setCategory] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const { data, error } = useQuery<Timeline>('timeline', { processId: id, ...(category ? { category } : {}), ...(applicationId ? { applicationId } : {}) }, [category, applicationId]);
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${id}`}>{t('back')}</a> · <a href={`/api/queries/staffing-file?processId=${id}`}>{t('timeline.export')}</a></p>
      <div className="flex gap-3 flex-wrap">
        <Field id="cat" label={t('timeline.category')}><select id="cat" className="input" value={category} onChange={e => setCategory(e.target.value)}><option value="">{t('timeline.all')}</option>{['process', 'application', 'screening', 'assessment', 'interview', 'offer', 'notification', 'privacy'].map(c => <option key={c} value={c}>{label('cat', c)}</option>)}</select></Field>
        <Field id="app" label={t('timeline.application_id')}><input id="app" className="input" value={applicationId} onChange={e => setApplicationId(e.target.value)} /></Field>
      </div>
      {error ? <p role="alert" className="field-error">{error}</p> : null}
      {data ? (
        <table className="table"><caption className="sr-only">{t('timeline.entries')}</caption><thead><tr><th scope="col">{t('timeline.when', { tz: data.timeZone })}</th><th scope="col">{t('timeline.action')}</th><th scope="col">{t('timeline.actor')}</th><th scope="col">{t('timeline.subject')}</th><th scope="col">{t('timeline.reason')}</th><th scope="col">{t('timeline.details')}</th></tr></thead><tbody>
          {data.entries.map(e => <tr key={e.position}><td><time dateTime={e.occurredAt}>{fmt(e.occurredAt, data.timeZone)}</time></td><td>{e.type}<br /><span className="badge">{label('cat', e.category)}</span></td><td>{e.actor.type}{e.actor.id ? `:${String(e.actor.id).slice(0, 8)}` : ''}{e.actor.role ? ` (${String(e.actor.role).split(',').map(r => label('role', r)).join(', ')})` : ''}</td><td>{e.subject ? (e.subject === 'Candidate (removed)' ? t('timeline.removed') : <a href={`/staff/applications/${e.applicationId}`}>{String(e.subject).slice(0, 8)}</a>) : '—'}</td><td>{e.reason ?? e.causationId ?? ''}</td><td><details><summary>{t('view')}</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(e.summary, null, 1)}</pre></details></td></tr>)}
        </tbody></table>
      ) : null}
    </>
  );
}
