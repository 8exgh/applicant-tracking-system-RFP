'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery, Status, Me } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { Field } from '@/components/ui';

type Detail = Awaited<ReturnType<typeof import('@/lib/queries/staff').applicationDetail>>;

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="Application">{me => <View id={id} me={me} />}</Shell>;
}

function View({ id, me }: { id: string; me: Me }) {
  const { data: a, error, reload } = useQuery<Detail>('application', { applicationId: id });
  const [status, setStatus] = useState('');
  if (error) return <p role="alert" className="field-error">{error}</p>;
  if (!a) return <p role="status">Loading…</p>;
  const run = async (name: string, body: Record<string, unknown>, done: string) => { try { await staffApi.command(name, { applicationId: id, ...body }); setStatus(done); reload(); } catch (e) { setStatus(errorMessage(e)); } };
  const can = (roles: string[]) => me.roles.some(r => roles.includes(r));
  const tz = a.process.timeZone;
  const essentials = a.process.criteria.filter(c => c.type === 'essential');
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${a.process.processId}`}>{a.process.reference}</a> · {a.process.title.en} · <span className="badge">{a.status}</span>{a.stage ? <span className="badge ml-1">{a.stage}</span> : null} · v{a.applicationVersion}{a.qualified === true ? <span className="badge ml-1">qualified</span> : a.qualified === false ? <span className="badge ml-1">not qualified ({a.failedCriteria.join(', ')})</span> : null}</p>
      <Status message={status} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-labelledby="cand"><h2 id="cand" className="font-bold mb-2">Candidate</h2>
          <p>{a.candidate.name}{a.candidate.removed ? '' : <> · {a.candidate.email}{a.candidate.phone ? ` · ${a.candidate.phone}` : ''} · {a.candidate.locale}</>}{a.candidate.emailBounced ? <span className="badge ml-1">Email undeliverable</span> : null}</p>
          {a.accommodationInPlace ? <p className="badge mt-1">Accommodation in place{a.accommodationInPlace.adjustments.some((x: { examTimeMultiplier?: number }) => x.examTimeMultiplier) ? ` (exam time ×${a.accommodationInPlace.adjustments.find((x: { examTimeMultiplier?: number }) => x.examTimeMultiplier)?.examTimeMultiplier})` : ''}</p> : null}
          <p className="text-sm mt-1">Source: {a.source?.source ?? 'Direct'} · Consent notice v{a.consentNoticeVersion ?? '—'} · Tags: {a.tags.join(', ') || '—'}</p>
          {can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <TagForm tags={a.tags} onSave={t => run('tag-application', { tags: t }, 'Tags saved')} /> : null}
          <h3 className="font-semibold mt-3">Documents</h3>
          <ul className="list-disc pl-5">{a.documents.map(d => <li key={d.documentId}>{d.scanStatus === 'Available' ? <a href={`/api/documents/${id}/${d.documentId}`}>{d.filename}</a> : d.filename} <span className="badge">{d.scanStatus}</span> {Math.round(d.size / 1024)} KB</li>)}</ul>
        </section>
        <section className="card" aria-labelledby="answers"><h2 id="answers" className="font-bold mb-2">Answers (v{a.applicationVersion})</h2>
          {a.process.knockouts.map(k => <p key={k.code}><strong>{k.code}</strong> {k.question.en}: {a.answers[k.code] ?? '—'}</p>)}
          {a.process.criteria.map(c => <div key={c.code} className="mb-2"><h3 className="font-semibold">{c.code} {c.text.en}</h3><p className="whitespace-pre-wrap">{a.answers[c.code] ?? '—'}</p></div>)}
          {a.versions.length > 1 ? <details><summary>Previous versions ({a.versions.length - 1})</summary>{a.versions.slice(0, -1).map(v => <div key={v.version} className="border-t mt-2 pt-2"><h4 className="font-semibold">Version {v.version} (superseded)</h4>{Object.entries(v.answers).map(([k, val]) => <p key={k}><strong>{k}</strong>: {String(val)}</p>)}</div>)}</details> : null}
        </section>
        {a.status === 'Submitted' && a.process.screeningOpen && can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <ScreeningForm essentials={essentials.map(c => c.code)} onIn={m => run('screen-in', { marks: m }, 'Screened in')} onOut={(m, r) => run('screen-out', { marks: m, rationale: r }, 'Screened out')} /> : null}
        {a.screening ? <section className="card" aria-labelledby="scr"><h2 id="scr" className="font-bold mb-2">Screening</h2><p>{a.screening.result === 'in' ? 'Screened in' : 'Screened out'}{a.screening.automatic ? ` automatically (${a.screening.knockoutCode})` : ''} · {Object.entries(a.screening.marks).map(([k, v]) => `${k}: ${v}`).join(', ')}</p>{a.screening.rationale ? <p>Rationale: {a.screening.rationale}</p> : null}{can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <ReasonAction label="Reverse screening" onSubmit={r => run('reverse-screening', { reason: r }, 'Screening reversed')} /> : null}</section> : null}
        <section className="card" aria-labelledby="scores"><h2 id="scores" className="font-bold mb-2">Scores and consensus</h2>
          {Object.keys(a.scores).length === 0 ? <p className="help">No scores visible yet{a.access === 'board' && !a.submittedAssessors.includes(me.userId) ? ' (other assessors’ scores appear after you submit yours)' : ''}.</p> : null}
          {Object.entries(a.scores).map(([assessor, byCrit]) => <p key={assessor}><strong>{me.users.find(u => u.userId === assessor)?.displayName ?? assessor.slice(0, 8)}</strong>{a.submittedAssessors.includes(assessor) ? ' (submitted)' : ''}: {Object.entries(byCrit).map(([c, s]) => `${c}=${s.score}${s.amendments.length ? '*' : ''}`).join(', ')}</p>)}
          {Object.entries(a.consensus).map(([c, list]) => <p key={c}><strong>Consensus {c}</strong>: {list.map((x, i) => <span key={i} className={i === list.length - 1 ? 'font-semibold' : 'line-through mr-1'}>{x.score} {x.pass ? 'pass' : 'fail'}</span>)}</p>)}
          <p className="text-sm mt-2"><a href={`/staff/processes/${a.process.processId}/assessment`}>Open the assessment workbook</a></p>
          {a.myConflictDeclared ? null : a.process.board.some(b => b.userId === me.userId) ? <button className="btn-secondary mt-2" onClick={() => staffApi.command('declare-conflict', { processId: a.process.processId, conflictedApplicationIds: [id] }).then(() => { setStatus('Conflict declared'); reload(); }).catch(e => setStatus(errorMessage(e)))}>Declare a conflict of interest with this candidate</button> : null}
        </section>
        <section className="card" aria-labelledby="notes"><h2 id="notes" className="font-bold mb-2">Notes</h2>
          <ul className="list-disc pl-5">{a.notes.map(n => <li key={n.noteId}><span className="badge mr-1">{n.visibility}</span>{n.text} <span className="text-xs">({new Date(n.at).toLocaleString('en-CA', { timeZone: tz })})</span></li>)}</ul>
          {can(['org_admin', 'hr_advisor', 'hiring_manager', 'assessor']) ? <NoteForm hr={can(['org_admin', 'hr_advisor'])} onSave={(t, v) => run('add-note', { text: t, visibility: v }, 'Note added')} /> : null}
        </section>
        {a.accommodations ? <section className="card" aria-labelledby="acc"><h2 id="acc" className="font-bold mb-2">Accommodation requests (HR only)</h2>{(a.accommodations as Array<{ requestId: string; text: string; contactPreference: string; stage: string | null; arrangement: { summary: string } | null }>).map(r => <div key={r.requestId} className="border-t pt-2 mt-2"><p>{r.text} <span className="text-xs">({r.contactPreference}{r.stage ? `, stage ${r.stage}` : ''})</span></p>{r.arrangement ? <p className="font-semibold">Arranged: {r.arrangement.summary}</p> : <ArrangeForm onSave={(s, m) => run('arrange-accommodation', { requestId: r.requestId, summary: s, examTimeMultiplier: m }, 'Arrangement recorded')} />}</div>)}</section> : null}
        {a.status === 'Active' && can(['org_admin', 'hr_advisor']) ? <section className="card" aria-labelledby="exam"><h2 id="exam" className="font-bold mb-2">Written exam</h2>{a.exam ? <p>{a.exam.criterionCode}: window {new Date(a.exam.windowStart).toLocaleString('en-CA', { timeZone: tz })} – {new Date(a.exam.windowEnd).toLocaleString('en-CA', { timeZone: tz })}, {a.exam.limitMinutes} min{a.exam.startedAt ? ` · started` : ''}{a.exam.submittedAt ? ` · submitted${a.exam.late ? ' LATE' : ''}` : ''}{a.exam.late && !a.exam.released ? <ReasonAction label="Release late submission" onSubmit={r => run('release-exam-late', { reason: r }, 'Released')} /> : null}</p> : <ExamForm criteria={a.process.plan.filter(e => e.method === 'written_exam').map(e => e.criterionCode)} onSave={(c, s, e, m) => run('assign-exam', { criterionCode: c, windowStart: s, windowEnd: e, limitMinutes: m }, 'Exam assigned')} />}</section> : null}
        {a.interview ? <section className="card" aria-labelledby="int"><h2 id="int" className="font-bold mb-2">Interview</h2><p>{a.interview.status} · {new Date(a.interview.at).toLocaleString('en-CA', { timeZone: tz, timeZoneName: 'short' })}</p>{a.interview.status === 'booked' && can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <ReasonAction label="Cancel interview" onSubmit={r => run('cancel-interview', { reason: r }, 'Interview cancelled')} /> : null}{can(['assessor', 'hiring_manager']) ? <NotesForm onSave={(c, n) => run('record-interview-notes', { criterionCode: c || undefined, notes: n }, 'Notes recorded')} criteria={a.process.criteria.map(c => c.code)} /> : null}</section> : null}
        <section className="card" aria-labelledby="offer"><h2 id="offer" className="font-bold mb-2">Offer</h2>
          {a.offer ? <p><span className="badge">{a.offer.status}</span> {(a.offer.fields as { position?: string; startDate?: string; salary?: string })?.position} · start {(a.offer.fields as { startDate?: string })?.startDate} · {(a.offer.fields as { salary?: string })?.salary}{a.offer.expiresAt ? ` · expires ${new Date(a.offer.expiresAt).toLocaleString('en-CA', { timeZone: tz })}` : ''}{a.offer.typedName ? ` · accepted by "${String(a.offer.typedName)}"` : ''}</p> : <p className="help">No offer yet.</p>}
          {a.qualified && a.status === 'Active' && (!a.offer || ['Declined', 'Expired', 'Rescinded'].includes(a.offer.status)) && can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <OfferForm onSave={f => run('draft-offer', f, 'Offer drafted')} /> : null}
          {a.offer?.status === 'Draft' && can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <div className="flex gap-2 mt-2"><button className="btn-secondary" onClick={() => run('request-offer-approval', { offerId: a.offer!.offerId }, 'Approval requested')}>Request approval</button>{!a.process.offerApprovalRequired && can(['org_admin', 'hr_advisor']) ? <SendOffer onSend={e => run('send-offer', { offerId: a.offer!.offerId, expiresAt: e }, 'Offer sent')} tz={tz} /> : null}</div> : null}
          {a.offer?.status === 'PendingApproval' && can(['org_admin']) ? <div className="flex gap-2 mt-2"><button className="btn-primary" onClick={() => run('approve-offer', { offerId: a.offer!.offerId }, 'Offer approved')}>Approve offer</button><ReasonAction label="Reject" onSubmit={r => run('reject-offer', { offerId: a.offer!.offerId, reason: r }, 'Offer rejected')} /></div> : null}
          {a.offer?.status === 'Approved' && can(['org_admin', 'hr_advisor']) ? <SendOffer onSend={e => run('send-offer', { offerId: a.offer!.offerId, expiresAt: e }, 'Offer sent')} tz={tz} /> : null}
          {a.offer && ['Sent', 'Approved', 'PendingApproval', 'Draft'].includes(a.offer.status) && can(['org_admin', 'hr_advisor']) ? <ReasonAction label="Rescind offer" onSubmit={r => run('rescind-offer', { offerId: a.offer!.offerId, reason: r }, 'Offer rescinded')} /> : null}
        </section>
      </div>
    </>
  );
}

function ReasonAction({ label, onSubmit }: { label: string; onSubmit: (r: string) => void }) {
  const [r, setR] = useState('');
  const id = label.toLowerCase().replace(/\W+/g, '-');
  return <span className="inline-flex flex-wrap items-end gap-2 mt-2"><span><label htmlFor={id} className="text-sm font-semibold block">Reason</label><input id={id} className="input" value={r} onChange={e => setR(e.target.value)} /></span><button type="button" className="btn-secondary" onClick={() => onSubmit(r)}>{label}</button></span>;
}

function TagForm({ tags, onSave }: { tags: string[]; onSave: (t: string[]) => void }) {
  const [v, setV] = useState(tags.join(', '));
  return <div className="mt-1 flex items-end gap-2"><Field id="tags" label="Tags (comma separated)"><input id="tags" className="input" value={v} onChange={e => setV(e.target.value)} /></Field><button className="btn-secondary mb-4" onClick={() => onSave(v.split(',').map(x => x.trim()).filter(Boolean))}>Save tags</button></div>;
}

function ScreeningForm({ essentials, onIn, onOut }: { essentials: string[]; onIn: (m: Record<string, string>) => void; onOut: (m: Record<string, string>, r: string) => void }) {
  const [marks, setMarks] = useState<Record<string, string>>(Object.fromEntries(essentials.map(c => [c, 'met'])));
  const [rationale, setRationale] = useState('');
  return <section className="card" aria-labelledby="screen"><h2 id="screen" className="font-bold mb-2">Screen</h2>
    {essentials.map(c => <fieldset key={c} className="mb-2"><legend className="font-semibold">{c}</legend>{['met', 'not_met'].map(v => <label key={v} className="inline-flex items-center gap-2 mr-4 min-h-[44px]"><input type="radio" name={`m-${c}`} className="h-5 w-5" checked={marks[c] === v} onChange={() => setMarks({ ...marks, [c]: v })} /> {v}</label>)}</fieldset>)}
    <Field id="rationale" label="Rationale (required to screen out, at least 20 characters)"><textarea id="rationale" className="input" rows={3} value={rationale} onChange={e => setRationale(e.target.value)} /></Field>
    <div className="flex gap-2"><button className="btn-primary" onClick={() => onIn(marks)}>Screen in</button><button className="btn-danger" onClick={() => onOut(marks, rationale)}>Screen out</button></div>
  </section>;
}

function NoteForm({ hr, onSave }: { hr: boolean; onSave: (t: string, v: string) => void }) {
  const [t, setT] = useState('');
  const [v, setV] = useState(hr ? 'hr_only' : 'process_team');
  return <div className="mt-2"><Field id="note" label="Add note"><textarea id="note" className="input" rows={2} value={t} onChange={e => setT(e.target.value)} /></Field><Field id="vis" label="Visibility"><select id="vis" className="input" value={v} onChange={e => setV(e.target.value)}>{hr ? <option value="hr_only">HR only</option> : null}<option value="process_team">Process team</option></select></Field><button className="btn-secondary" onClick={() => { onSave(t, v); setT(''); }}>Add note</button></div>;
}

function ArrangeForm({ onSave }: { onSave: (s: string, m?: number) => void }) {
  const [s, setS] = useState('');
  const [m, setM] = useState('');
  return <div className="mt-1"><Field id="arr" label="Arrangement summary (what the board sees is only that one is in place)"><input id="arr" className="input" value={s} onChange={e => setS(e.target.value)} /></Field><Field id="mult" label="Exam time multiplier (e.g. 1.5)"><input id="mult" className="input w-24" value={m} onChange={e => setM(e.target.value)} /></Field><button className="btn-secondary" onClick={() => onSave(s, m ? parseFloat(m) : undefined)}>Record arrangement</button></div>;
}

function ExamForm({ criteria, onSave }: { criteria: string[]; onSave: (c: string, s: string, e: string, m: number) => void }) {
  const [c, setC] = useState(criteria[0] ?? '');
  const [s, setS] = useState('');
  const [e, setE] = useState('');
  const [m, setM] = useState(90);
  if (!criteria.length) return <p className="help">No written exam in the assessment plan.</p>;
  return <div className="grid sm:grid-cols-4 gap-2 items-end"><Field id="ec" label="Criterion"><select id="ec" className="input" value={c} onChange={x => setC(x.target.value)}>{criteria.map(x => <option key={x}>{x}</option>)}</select></Field><Field id="es" label="Window start"><input id="es" className="input" placeholder="2027-02-01 09:00" value={s} onChange={x => setS(x.target.value)} /></Field><Field id="ee" label="Window end"><input id="ee" className="input" placeholder="2027-02-03 17:00" value={e} onChange={x => setE(x.target.value)} /></Field><Field id="em" label="Limit (min)"><input id="em" type="number" className="input" value={m} onChange={x => setM(+x.target.value)} /></Field><button className="btn-secondary mb-4" onClick={() => onSave(c, s, e, m)}>Assign exam</button></div>;
}

function NotesForm({ criteria, onSave }: { criteria: string[]; onSave: (c: string, n: string) => void }) {
  const [c, setC] = useState('');
  const [n, setN] = useState('');
  return <div className="mt-2"><Field id="nc" label="Criterion"><select id="nc" className="input" value={c} onChange={e => setC(e.target.value)}><option value="">—</option>{criteria.map(x => <option key={x}>{x}</option>)}</select></Field><Field id="nn" label="Interview notes"><textarea id="nn" className="input" rows={3} value={n} onChange={e => setN(e.target.value)} /></Field><button className="btn-secondary" onClick={() => { onSave(c, n); setN(''); }}>Record notes</button></div>;
}

function OfferForm({ onSave }: { onSave: (f: Record<string, string>) => void }) {
  const [f, setF] = useState({ position: '', startDate: '', salary: '', letter: '' });
  return <div className="mt-2 grid sm:grid-cols-3 gap-2"><Field id="op" label="Position"><input id="op" className="input" value={f.position} onChange={e => setF({ ...f, position: e.target.value })} /></Field><Field id="os" label="Start date (YYYY-MM-DD)"><input id="os" className="input" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} /></Field><Field id="osal" label="Salary"><input id="osal" className="input" value={f.salary} onChange={e => setF({ ...f, salary: e.target.value })} /></Field><div className="sm:col-span-3"><Field id="ol" label="Letter text"><textarea id="ol" className="input" rows={4} value={f.letter} onChange={e => setF({ ...f, letter: e.target.value })} /></Field><button className="btn-primary" onClick={() => onSave(f)}>Draft offer</button></div></div>;
}

function SendOffer({ onSend, tz }: { onSend: (e: string) => void; tz: string }) {
  const [e, setE] = useState('');
  return <span className="inline-flex items-end gap-2"><span><label htmlFor="exp" className="text-sm font-semibold block">Expires ({tz})</label><input id="exp" className="input" placeholder="2027-03-17 23:59" value={e} onChange={x => setE(x.target.value)} /></span><button className="btn-primary" onClick={() => onSend(e)}>Send offer</button></span>;
}
