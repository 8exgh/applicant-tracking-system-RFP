'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery, Status, Me, useI18n, pick } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { Field } from '@/components/ui';

type Detail = Awaited<ReturnType<typeof import('@/lib/queries/staff').applicationDetail>>;

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="app.title">{me => <View id={id} me={me} />}</Shell>;
}

function View({ id, me }: { id: string; me: Me }) {
  const { t, lang, label, fmt } = useI18n();
  const { data: a, error, reload } = useQuery<Detail>('application', { applicationId: id });
  const [status, setStatus] = useState('');
  if (error) return <p role="alert" className="field-error">{error}</p>;
  if (!a) return <p role="status">{t('loading')}</p>;
  const run = async (name: string, body: Record<string, unknown>, done: string) => { try { await staffApi.command(name, { applicationId: id, ...body }); setStatus(done); reload(); } catch (e) { setStatus(errorMessage(e)); } };
  const can = (roles: string[]) => me.roles.some(r => roles.includes(r));
  const tz = a.process.timeZone;
  const essentials = a.process.criteria.filter(c => c.type === 'essential');
  const stageName = (s: string | undefined) => { const st = a.process.stages.find(x => x.stageId === s); return st ? pick(st.name, lang) : s ?? ''; };
  const offerFields = (a.offer?.fields ?? {}) as { position?: string; startDate?: string; salary?: string };
  const multiplier = a.accommodationInPlace?.adjustments.find((x: { examTimeMultiplier?: number }) => x.examTimeMultiplier)?.examTimeMultiplier;
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${a.process.processId}`}>{a.process.reference}</a> · {pick(a.process.title, lang)} · <span className="badge">{label('as', a.status)}</span>{a.stage ? <span className="badge ml-1">{stageName(a.stage)}</span> : null} · v{a.applicationVersion}{a.qualified === true ? <span className="badge ml-1">{t('pipeline.qualified')}</span> : a.qualified === false ? <span className="badge ml-1">{t('app.not_qualified', { codes: a.failedCriteria.join(', ') })}</span> : null}</p>
      <Status message={status} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-labelledby="cand"><h2 id="cand" className="font-bold mb-2">{t('app.candidate')}</h2>
          <p>{a.candidate.name}{a.candidate.removed ? '' : <> · {a.candidate.email}{a.candidate.phone ? ` · ${a.candidate.phone}` : ''} · {a.candidate.locale}</>}{a.candidate.emailBounced ? <span className="badge ml-1">{t('pipeline.bounced')}</span> : null}</p>
          {a.accommodationInPlace ? <p className="badge mt-1">{t('app.accommodation_in_place')}{multiplier ? t('app.exam_time', { m: multiplier }) : ''}</p> : null}
          <p className="text-sm mt-1">{t('app.source')} : {a.source?.source ?? t('app.direct')} · {t('app.consent', { v: a.consentNoticeVersion ?? '—' })} · {t('app.tags')} : {a.tags.join(', ') || '—'}</p>
          {can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <TagForm tags={a.tags} onSave={x => run('tag-application', { tags: x }, t('app.tags_saved'))} /> : null}
          <h3 className="font-semibold mt-3">{t('app.documents')}</h3>
          <ul className="list-disc pl-5">{a.documents.map(d => <li key={d.documentId}>{d.scanStatus === 'Available' ? <a href={`/api/documents/${id}/${d.documentId}`}>{d.filename}</a> : d.filename} <span className="badge">{d.scanStatus}</span> {Math.round(d.size / 1024)} Ko</li>)}</ul>
        </section>
        <section className="card" aria-labelledby="answers"><h2 id="answers" className="font-bold mb-2">{t('app.answers', { v: a.applicationVersion })}</h2>
          {a.process.knockouts.map(k => <p key={k.code}><strong>{k.code}</strong> {pick(k.question, lang)} : {a.answers[k.code] ?? '—'}</p>)}
          {a.process.criteria.map(c => <div key={c.code} className="mb-2"><h3 className="font-semibold">{c.code} {pick(c.text, lang)}</h3><p className="whitespace-pre-wrap">{a.answers[c.code] ?? '—'}</p></div>)}
          {a.versions.length > 1 ? <details><summary>{t('app.previous', { n: a.versions.length - 1 })}</summary>{a.versions.slice(0, -1).map(v => <div key={v.version} className="border-t mt-2 pt-2"><h4 className="font-semibold">{t('app.version_superseded', { v: v.version })}</h4>{Object.entries(v.answers).map(([k, val]) => <p key={k}><strong>{k}</strong> : {String(val)}</p>)}</div>)}</details> : null}
        </section>
        {a.status === 'Submitted' && a.process.screeningOpen && can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <ScreeningForm essentials={essentials.map(c => c.code)} onIn={m => run('screen-in', { marks: m }, t('app.screened_in'))} onOut={(m, r) => run('screen-out', { marks: m, rationale: r }, t('app.screened_out'))} /> : null}
        {a.screening ? <section className="card" aria-labelledby="scr"><h2 id="scr" className="font-bold mb-2">{t('app.screening')}</h2><p>{a.screening.result === 'in' ? t('app.screened_in') : t('app.screened_out')}{a.screening.automatic ? t('app.automatically', { code: a.screening.knockoutCode ?? '' }) : ''} · {Object.entries(a.screening.marks).map(([k, v]) => `${k} : ${v === 'met' ? t('app.met') : t('app.not_met')}`).join(', ')}</p>{a.screening.rationale ? <p>{t('app.rationale_label')} : {a.screening.rationale}</p> : null}{can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <ReasonAction label={t('app.reverse')} onSubmit={r => run('reverse-screening', { reason: r }, t('app.reversed'))} /> : null}</section> : null}
        <section className="card" aria-labelledby="scores"><h2 id="scores" className="font-bold mb-2">{t('app.scores')}</h2>
          {Object.keys(a.scores).length === 0 ? <p className="help">{t('app.no_scores')}{a.access === 'board' && !a.submittedAssessors.includes(me.userId) ? t('app.after_submit') : ''}.</p> : null}
          {Object.entries(a.scores).map(([assessor, byCrit]) => <p key={assessor}><strong>{me.users.find(u => u.userId === assessor)?.displayName ?? assessor.slice(0, 8)}</strong>{a.submittedAssessors.includes(assessor) ? ` ${t('app.submitted')}` : ''} : {Object.entries(byCrit).map(([c, s]) => `${c}=${s.score}${s.amendments.length ? '*' : ''}`).join(', ')}</p>)}
          {Object.entries(a.consensus).map(([c, list]) => <p key={c}><strong>{t('app.consensus', { code: c })}</strong> : {list.map((x, i) => <span key={i} className={i === list.length - 1 ? 'font-semibold' : 'line-through mr-1'}>{x.score} {x.pass ? t('assessment.pass') : t('assessment.fail')}</span>)}</p>)}
          <p className="text-sm mt-2"><a href={`/staff/processes/${a.process.processId}/assessment`}>{t('app.open_workbook')}</a></p>
          {a.myConflictDeclared ? null : a.process.board.some(b => b.userId === me.userId) ? <button className="btn-secondary mt-2" onClick={() => staffApi.command('declare-conflict', { processId: a.process.processId, conflictedApplicationIds: [id] }).then(() => { setStatus(t('app.conflict_declared')); reload(); }).catch(e => setStatus(errorMessage(e)))}>{t('app.declare_conflict')}</button> : null}
        </section>
        <section className="card" aria-labelledby="notes"><h2 id="notes" className="font-bold mb-2">{t('app.notes')}</h2>
          <ul className="list-disc pl-5">{a.notes.map(n => <li key={n.noteId}><span className="badge mr-1">{label('vis', n.visibility)}</span>{n.text} <span className="text-xs">({fmt(n.at, tz)})</span></li>)}</ul>
          {can(['org_admin', 'hr_advisor', 'hiring_manager', 'assessor']) ? <NoteForm hr={can(['org_admin', 'hr_advisor'])} onSave={(x, v) => run('add-note', { text: x, visibility: v }, t('app.note_added'))} /> : null}
        </section>
        {a.accommodations ? <section className="card" aria-labelledby="acc"><h2 id="acc" className="font-bold mb-2">{t('app.accommodations')}</h2>{(a.accommodations as Array<{ requestId: string; text: string; contactPreference: string; stage: string | null; arrangement: { summary: string } | null }>).map(r => <div key={r.requestId} className="border-t pt-2 mt-2"><p>{r.text} <span className="text-xs">({r.contactPreference}{r.stage ? t('app.stage_at', { stage: stageName(r.stage) }) : ''})</span></p>{r.arrangement ? <p className="font-semibold">{t('app.arranged')} : {r.arrangement.summary}</p> : <ArrangeForm onSave={(s, m) => run('arrange-accommodation', { requestId: r.requestId, summary: s, examTimeMultiplier: m }, t('app.arrangement_recorded'))} />}</div>)}</section> : null}
        {a.status === 'Active' && can(['org_admin', 'hr_advisor']) ? <section className="card" aria-labelledby="exam"><h2 id="exam" className="font-bold mb-2">{t('app.exam')}</h2>{a.exam ? <p>{a.exam.criterionCode} : {t('app.window')} {fmt(a.exam.windowStart, tz)} – {fmt(a.exam.windowEnd, tz)}, {a.exam.limitMinutes} min{a.exam.startedAt ? ` · ${t('app.started')}` : ''}{a.exam.submittedAt ? ` · ${t('app.submitted_exam')}${a.exam.late ? ` ${t('app.late')}` : ''}` : ''}{a.exam.late && !a.exam.released ? <ReasonAction label={t('app.release_late')} onSubmit={r => run('release-exam-late', { reason: r }, t('app.released'))} /> : null}</p> : <ExamForm criteria={a.process.plan.filter(e => e.method === 'written_exam').map(e => e.criterionCode)} onSave={(c, s, e, m) => run('assign-exam', { criterionCode: c, windowStart: s, windowEnd: e, limitMinutes: m }, t('app.exam_assigned'))} />}</section> : null}
        {a.interview ? <section className="card" aria-labelledby="int"><h2 id="int" className="font-bold mb-2">{t('app.interview')}</h2><p>{label('slot', a.interview.status)} · {fmt(a.interview.at, tz)}</p>{a.interview.status === 'booked' && can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <ReasonAction label={t('app.cancel_interview')} onSubmit={r => run('cancel-interview', { reason: r }, t('app.interview_cancelled'))} /> : null}{can(['assessor', 'hiring_manager']) ? <NotesForm onSave={(c, n) => run('record-interview-notes', { criterionCode: c || undefined, notes: n }, t('app.notes_recorded'))} criteria={a.process.criteria.map(c => c.code)} /> : null}</section> : null}
        <section className="card" aria-labelledby="offer"><h2 id="offer" className="font-bold mb-2">{t('app.offer')}</h2>
          {a.offer ? <p><span className="badge">{label('os', a.offer.status)}</span> {offerFields.position} · {t('app.start')} {offerFields.startDate} · {offerFields.salary}{a.offer.expiresAt ? ` · ${t('app.expires')} ${fmt(a.offer.expiresAt, tz)}` : ''}{a.offer.typedName ? ` · ${t('app.accepted_by')} « ${String(a.offer.typedName)} »` : ''}</p> : <p className="help">{t('app.no_offer')}</p>}
          {a.qualified && a.status === 'Active' && (!a.offer || ['Declined', 'Expired', 'Rescinded'].includes(a.offer.status)) && can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <OfferForm onSave={f => run('draft-offer', f, t('app.offer_drafted'))} /> : null}
          {a.offer?.status === 'Draft' && can(['org_admin', 'hr_advisor', 'hiring_manager']) ? <div className="flex gap-2 mt-2"><button className="btn-secondary" onClick={() => run('request-offer-approval', { offerId: a.offer!.offerId }, t('done.approval_requested'))}>{t('app.request_offer_approval')}</button>{!a.process.offerApprovalRequired && can(['org_admin', 'hr_advisor']) ? <SendOffer onSend={e => run('send-offer', { offerId: a.offer!.offerId, expiresAt: e }, t('app.offer_sent'))} tz={tz} /> : null}</div> : null}
          {a.offer?.status === 'PendingApproval' && can(['org_admin']) ? <div className="flex gap-2 mt-2"><button className="btn-primary" onClick={() => run('approve-offer', { offerId: a.offer!.offerId }, t('app.offer_approved'))}>{t('app.approve_offer')}</button><ReasonAction label={t('app.reject')} onSubmit={r => run('reject-offer', { offerId: a.offer!.offerId, reason: r }, t('app.offer_rejected'))} /></div> : null}
          {a.offer?.status === 'Approved' && can(['org_admin', 'hr_advisor']) ? <SendOffer onSend={e => run('send-offer', { offerId: a.offer!.offerId, expiresAt: e }, t('app.offer_sent'))} tz={tz} /> : null}
          {a.offer && ['Sent', 'Approved', 'PendingApproval', 'Draft'].includes(a.offer.status) && can(['org_admin', 'hr_advisor']) ? <ReasonAction label={t('app.rescind')} onSubmit={r => run('rescind-offer', { offerId: a.offer!.offerId, reason: r }, t('app.offer_rescinded'))} /> : null}
        </section>
      </div>
    </>
  );
}

function ReasonAction({ label: text, onSubmit }: { label: string; onSubmit: (r: string) => void }) {
  const { t } = useI18n();
  const [r, setR] = useState('');
  const id = text.toLowerCase().replace(/\W+/g, '-');
  return <span className="inline-flex flex-wrap items-end gap-2 mt-2"><span><label htmlFor={id} className="text-sm font-semibold block">{t('reason')}</label><input id={id} className="input" value={r} onChange={e => setR(e.target.value)} /></span><button type="button" className="btn-secondary" onClick={() => onSubmit(r)}>{text}</button></span>;
}

function TagForm({ tags, onSave }: { tags: string[]; onSave: (t: string[]) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState(tags.join(', '));
  return <div className="mt-1 flex items-end gap-2"><Field id="tags" label={t('app.tags_help')}><input id="tags" className="input" value={v} onChange={e => setV(e.target.value)} /></Field><button className="btn-secondary mb-4" onClick={() => onSave(v.split(',').map(x => x.trim()).filter(Boolean))}>{t('app.save_tags')}</button></div>;
}

function ScreeningForm({ essentials, onIn, onOut }: { essentials: string[]; onIn: (m: Record<string, string>) => void; onOut: (m: Record<string, string>, r: string) => void }) {
  const { t } = useI18n();
  const [marks, setMarks] = useState<Record<string, string>>(Object.fromEntries(essentials.map(c => [c, 'met'])));
  const [rationale, setRationale] = useState('');
  return <section className="card" aria-labelledby="screen"><h2 id="screen" className="font-bold mb-2">{t('app.screen')}</h2>
    {essentials.map(c => <fieldset key={c} className="mb-2"><legend className="font-semibold">{c}</legend>{(['met', 'not_met'] as const).map(v => <label key={v} className="inline-flex items-center gap-2 mr-4 min-h-[44px]"><input type="radio" name={`m-${c}`} className="h-5 w-5" checked={marks[c] === v} onChange={() => setMarks({ ...marks, [c]: v })} /> {t(v === 'met' ? 'app.met' : 'app.not_met')}</label>)}</fieldset>)}
    <Field id="rationale" label={t('app.rationale')}><textarea id="rationale" className="input" rows={3} value={rationale} onChange={e => setRationale(e.target.value)} /></Field>
    <div className="flex gap-2"><button className="btn-primary" onClick={() => onIn(marks)}>{t('app.screen_in')}</button><button className="btn-danger" onClick={() => onOut(marks, rationale)}>{t('app.screen_out')}</button></div>
  </section>;
}

function NoteForm({ hr, onSave }: { hr: boolean; onSave: (t: string, v: string) => void }) {
  const { t, label } = useI18n();
  const [x, setX] = useState('');
  const [v, setV] = useState(hr ? 'hr_only' : 'process_team');
  return <div className="mt-2"><Field id="note" label={t('app.add_note')}><textarea id="note" className="input" rows={2} value={x} onChange={e => setX(e.target.value)} /></Field><Field id="vis" label={t('app.visibility')}><select id="vis" className="input" value={v} onChange={e => setV(e.target.value)}>{hr ? <option value="hr_only">{label('vis', 'hr_only')}</option> : null}<option value="process_team">{label('vis', 'process_team')}</option></select></Field><button className="btn-secondary" onClick={() => { onSave(x, v); setX(''); }}>{t('app.add_note')}</button></div>;
}

function ArrangeForm({ onSave }: { onSave: (s: string, m?: number) => void }) {
  const { t } = useI18n();
  const [s, setS] = useState('');
  const [m, setM] = useState('');
  return <div className="mt-1"><Field id="arr" label={t('app.arrangement')}><input id="arr" className="input" value={s} onChange={e => setS(e.target.value)} /></Field><Field id="mult" label={t('app.multiplier')}><input id="mult" className="input w-24" value={m} onChange={e => setM(e.target.value)} /></Field><button className="btn-secondary" onClick={() => onSave(s, m ? parseFloat(m.replace(',', '.')) : undefined)}>{t('app.record_arrangement')}</button></div>;
}

function ExamForm({ criteria, onSave }: { criteria: string[]; onSave: (c: string, s: string, e: string, m: number) => void }) {
  const { t } = useI18n();
  const [c, setC] = useState(criteria[0] ?? '');
  const [s, setS] = useState('');
  const [e, setE] = useState('');
  const [m, setM] = useState(90);
  if (!criteria.length) return <p className="help">{t('app.no_exam')}</p>;
  return <div className="grid sm:grid-cols-4 gap-2 items-end"><Field id="ec" label={t('editor.criterion')}><select id="ec" className="input" value={c} onChange={x => setC(x.target.value)}>{criteria.map(x => <option key={x}>{x}</option>)}</select></Field><Field id="es" label={t('app.window_start')}><input id="es" className="input" placeholder="2027-02-01 09:00" value={s} onChange={x => setS(x.target.value)} /></Field><Field id="ee" label={t('app.window_end')}><input id="ee" className="input" placeholder="2027-02-03 17:00" value={e} onChange={x => setE(x.target.value)} /></Field><Field id="em" label={t('app.limit')}><input id="em" type="number" className="input" value={m} onChange={x => setM(+x.target.value)} /></Field><button className="btn-secondary mb-4" onClick={() => onSave(c, s, e, m)}>{t('app.assign_exam')}</button></div>;
}

function NotesForm({ criteria, onSave }: { criteria: string[]; onSave: (c: string, n: string) => void }) {
  const { t } = useI18n();
  const [c, setC] = useState('');
  const [n, setN] = useState('');
  return <div className="mt-2"><Field id="nc" label={t('editor.criterion')}><select id="nc" className="input" value={c} onChange={e => setC(e.target.value)}><option value="">—</option>{criteria.map(x => <option key={x}>{x}</option>)}</select></Field><Field id="nn" label={t('app.interview_notes')}><textarea id="nn" className="input" rows={3} value={n} onChange={e => setN(e.target.value)} /></Field><button className="btn-secondary" onClick={() => { onSave(c, n); setN(''); }}>{t('app.record_notes')}</button></div>;
}

function OfferForm({ onSave }: { onSave: (f: Record<string, string>) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ position: '', startDate: '', salary: '', letter: '' });
  return <div className="mt-2 grid sm:grid-cols-3 gap-2"><Field id="op" label={t('app.position')}><input id="op" className="input" value={f.position} onChange={e => setF({ ...f, position: e.target.value })} /></Field><Field id="os" label={t('app.start_date')}><input id="os" className="input" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} /></Field><Field id="osal" label={t('app.salary')}><input id="osal" className="input" value={f.salary} onChange={e => setF({ ...f, salary: e.target.value })} /></Field><div className="sm:col-span-3"><Field id="ol" label={t('app.letter')}><textarea id="ol" className="input" rows={4} value={f.letter} onChange={e => setF({ ...f, letter: e.target.value })} /></Field><button className="btn-primary" onClick={() => onSave(f)}>{t('app.draft_offer')}</button></div></div>;
}

function SendOffer({ onSend, tz }: { onSend: (e: string) => void; tz: string }) {
  const { t } = useI18n();
  const [e, setE] = useState('');
  return <span className="inline-flex items-end gap-2"><span><label htmlFor="exp" className="text-sm font-semibold block">{t('app.expires_at', { tz })}</label><input id="exp" className="input" placeholder="2027-03-17 23:59" value={e} onChange={x => setE(x.target.value)} /></span><button className="btn-primary" onClick={() => onSend(e)}>{t('app.send_offer')}</button></span>;
}
