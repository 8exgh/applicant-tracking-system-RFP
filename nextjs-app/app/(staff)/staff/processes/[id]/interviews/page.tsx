'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery, Status } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { Field } from '@/components/ui';

type Slots = Awaited<ReturnType<typeof import('@/lib/queries/staff').interviewSlots>>;
type Board = Awaited<ReturnType<typeof import('@/lib/queries/staff').pipelineBoard>>;

export default function Interviews() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="Interviews">{me => <View id={id} tz={me.org.timeZone} users={me.users} />}</Shell>;
}

function View({ id, tz, users }: { id: string; tz: string; users: Array<{ userId: string; displayName: string }> }) {
  const slots = useQuery<Slots>('interview-slots', { processId: id });
  const board = useQuery<Board>('pipeline-board', { processId: id });
  const [status, setStatus] = useState('');
  const [range, setRange] = useState({ start: '', end: '', minutes: 45, buffer: 15, board: [] as string[] });
  const [invite, setInvite] = useState<string[]>([]);
  const fmt = (d: string) => new Date(d).toLocaleString('en-CA', { timeZone: tz, timeZoneName: 'short' });
  const run = async (name: string, body: Record<string, unknown>, done: string) => { try { await staffApi.command(name, body); setStatus(done); slots.reload(); board.reload(); } catch (e) { setStatus(errorMessage(e)); } };
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${id}`}>Back to process</a></p>
      <Status message={status} />
      <section className="card mb-3" aria-labelledby="pub"><h2 id="pub" className="font-bold mb-2">Publish availability</h2>
        <div className="grid sm:grid-cols-4 gap-2">
          <Field id="r-start" label={`From (${tz})`}><input id="r-start" className="input" placeholder="2027-02-17 09:00" value={range.start} onChange={e => setRange({ ...range, start: e.target.value })} /></Field>
          <Field id="r-end" label="To"><input id="r-end" className="input" placeholder="2027-02-17 12:00" value={range.end} onChange={e => setRange({ ...range, end: e.target.value })} /></Field>
          <Field id="r-min" label="Slot minutes"><input id="r-min" type="number" className="input" value={range.minutes} onChange={e => setRange({ ...range, minutes: +e.target.value })} /></Field>
          <Field id="r-buf" label="Buffer minutes"><input id="r-buf" type="number" className="input" value={range.buffer} onChange={e => setRange({ ...range, buffer: +e.target.value })} /></Field>
        </div>
        <fieldset className="mb-2"><legend className="label">Board members present</legend>{users.map(u => <label key={u.userId} className="inline-flex items-center gap-2 mr-4 min-h-[44px]"><input type="checkbox" className="h-5 w-5" checked={range.board.includes(u.userId)} onChange={e => setRange(r => ({ ...r, board: e.target.checked ? [...r.board, u.userId] : r.board.filter(x => x !== u.userId) }))} /> {u.displayName}</label>)}</fieldset>
        <button className="btn-primary" onClick={() => run('publish-interview-slots', { processId: id, ranges: [{ start: range.start, end: range.end, minutes: range.minutes, bufferMinutes: range.buffer, boardUserIds: range.board }] }, 'Slots published')}>Publish slots</button>
      </section>
      <section className="card mb-3" aria-labelledby="slots"><h2 id="slots" className="font-bold mb-2">Slots</h2>
        <table className="table"><caption className="sr-only">Interview slots</caption><thead><tr><th scope="col">Starts</th><th scope="col">Ends</th><th scope="col">Status</th><th scope="col">Candidate</th></tr></thead><tbody>
          {(slots.data ?? []).map(s => <tr key={s.slotId}><td>{fmt(s.startsAt)}</td><td>{fmt(s.endsAt)}</td><td>{s.status}</td><td>{s.applicationId ? <a href={`/staff/applications/${s.applicationId}`}>{board.data?.cards.find(c => c.applicationId === s.applicationId)?.name ?? s.applicationId}</a> : '—'}</td></tr>)}
        </tbody></table>
      </section>
      <section className="card" aria-labelledby="inv"><h2 id="inv" className="font-bold mb-2">Invite candidates to self-book</h2>
        <ul className="list-none p-0 m-0">{(board.data?.cards ?? []).filter(c => c.status === 'Active').map(c => <li key={c.applicationId}><label className="inline-flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="h-5 w-5" checked={invite.includes(c.applicationId)} onChange={e => setInvite(s => e.target.checked ? [...s, c.applicationId] : s.filter(x => x !== c.applicationId))} /> {c.name} ({c.stage})</label></li>)}</ul>
        <button className="btn-primary" onClick={() => run('send-interview-invitations', { applicationIds: invite }, 'Invitations sent')}>Send invitations</button>
      </section>
    </>
  );
}
