'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery, langMapInput, Status, Me, useI18n, pick } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { Field } from '@/components/ui';
import type { StaffKey } from '@/lib/i18n/staff';

type Detail = Awaited<ReturnType<typeof import('@/lib/queries/staff').processDetail>>;

export default function ProcessEditor() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="editor.title">{me => <Editor id={id} me={me} />}</Shell>;
}

function Editor({ id, me }: { id: string; me: Me }) {
  const { t, lang, label, fmt } = useI18n();
  const { data: p, error, reload } = useQuery<Detail>('process', { processId: id });
  const [status, setStatus] = useState('');
  if (error) return <p role="alert" className="field-error">{error}</p>;
  if (!p) return <p role="status">{t('loading')}</p>;
  const run = async (name: string, body: Record<string, unknown>, done: StaffKey | string = 'saved', values?: Record<string, string | number>) => {
    try { await staffApi.command(name, { processId: id, ...body }, { expectedVersion: p.version }); setStatus(t(done as StaffKey, values)); reload(); } catch (e) { setStatus(errorMessage(e)); }
  };
  const editable = p.status === 'Draft';
  const canPublish = me.roles.some(r => ['org_admin', 'hr_advisor'].includes(r));
  const canApprove = me.roles.includes('org_admin');
  const langs = p.org.languages;
  const tz = p.org.timeZone;
  const sub: Array<[string, StaffKey]> = [['pipeline', 'sec.pipeline'], ['screening', 'sec.screening'], ['assessment', 'sec.assessment'], ['interviews', 'sec.interviews'], ['timeline', 'sec.timeline'], ['reports', 'sec.reports']];
  const other = lang === 'en' ? 'fr' : 'en';
  return (
    <>
      <p className="mb-2"><strong>{p.reference}</strong> · <span className="badge">{label('ps', p.status)}</span> · v{p.version} · {pick(p.title, lang)}</p>
      <nav aria-label={t('editor.sections')} className="mb-4"><ul className="flex flex-wrap gap-3 list-none p-0 m-0">{sub.map(([s, k]) => <li key={s}><a href={`/staff/processes/${id}/${s}`}>{t(k)}</a></li>)}</ul></nav>
      <Status message={status} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Completeness p={p} />
        <section className="card" aria-labelledby="approval"><h2 id="approval" className="text-lg font-bold mb-2">{t('editor.approval')}</h2>
          {p.status === 'Draft' ? <button className="btn-primary" onClick={() => run('request-approval', {}, 'done.approval_requested')}>{t('editor.request_approval')}</button> : null}
          {p.status === 'PendingApproval' && canApprove ? <ApprovalForm onApprove={c => run('approve-process', { comment: c }, 'done.approved')} onReject={r => run('reject-process', { reason: r }, 'done.rejected')} /> : null}
          {p.status === 'PendingApproval' && !canApprove ? <p>{t('editor.awaiting')}</p> : null}
          {['Approved', 'Scheduled'].includes(p.status) && canPublish ? <PublishForm tz={tz} onPublish={c => run('publish-posting', { closeAt: c }, 'done.published')} onSchedule={(pa, c) => run('schedule-posting', { publishAt: pa, closeAt: c }, 'done.scheduled')} onReturn={r => run('return-to-draft', { reason: r }, 'done.returned')} /> : null}
          {p.status === 'Posted' && canPublish ? <PostedControls p={p} tz={tz} run={run} langs={langs} /> : null}
          {p.status === 'Closed' && canPublish ? <button className="btn-primary" onClick={() => run('complete-process', {}, 'done.completed')}>{t('editor.complete')}</button> : null}
          {!['Completed', 'Cancelled'].includes(p.status) && canPublish ? <ReasonButton label={t('editor.cancel_process')} cls="btn-danger" onSubmit={r => run('cancel-process', { reason: r }, 'done.cancelled')} /> : null}
          <p className="mt-3"><ReasonButton label={t('editor.clone')} cls="btn-secondary" onSubmit={x => staffApi.command('clone-process', { processId: id, title: { en: x } }).then(r => { location.href = `/staff/processes/${r.processId}`; }).catch(e => setStatus(errorMessage(e)))} placeholder={t('editor.clone_title')} /></p>
        </section>
        <section className="card" aria-labelledby="criteria"><h2 id="criteria" className="text-lg font-bold mb-2">{t('editor.criteria')}</h2>
          <table className="table"><caption className="sr-only">{t('editor.criteria')}</caption><thead><tr><th scope="col">{t('editor.code')}</th><th scope="col">{t('editor.type')}</th><th scope="col">{t('editor.text')}</th><th scope="col">{t('editor.methods')}</th></tr></thead><tbody>
            {p.criteria.map(c => <tr key={c.code}><td>{c.code}</td><td>{label('ct', c.type)}</td><td>{c.text[lang]}<br /><span lang={other}>{c.text[other]}</span></td><td>{p.plan.filter(e => e.criterionCode === c.code).map(e => <span key={e.method} className="badge mr-1">{label('m', e.method)}{e.rubricId ? ` (${e.rubricId})` : ''}{editable ? <button type="button" className="ml-1 underline" aria-label={t('editor.remove_method', { method: label('m', e.method), code: c.code })} onClick={() => run('remove-assessment-method', { criterionCode: c.code, method: e.method })}>×</button> : null}</span>)}{editable ? <button type="button" className="underline text-sm" aria-label={t('editor.remove_criterion', { code: c.code })} onClick={() => run('remove-criterion', { code: c.code })}>{t('remove')}</button> : null}</td></tr>)}
          </tbody></table>
          {editable ? <><AddCriterion langs={langs} onAdd={(type, text) => run('add-criterion', { type, text }, 'done.criterion_added')} /><AddMethod criteria={p.criteria.map(c => c.code)} rubrics={p.rubrics.map(r => r.rubricId)} onAdd={(criterionCode, method, rubricId) => run('assign-assessment-method', { criterionCode, method, rubricId }, 'done.method_assigned')} /><AddRubric langs={langs} onAdd={r => run('define-rubric', r, 'done.rubric_defined')} /><AddKnockout langs={langs} onAdd={(q, exp) => run('add-knockout', { question: q, expected: exp }, 'done.knockout_added')} /></> : <p className="help">{t('editor.locked')}</p>}
          {p.knockouts.length ? <p className="mt-2 text-sm">{t('editor.knockouts')} : {p.knockouts.map(k => `${k.code} (${t(k.expected === 'yes' ? 'yes' : 'no')})`).join(', ')}</p> : null}
          {p.rubrics.length ? <p className="text-sm">{t('editor.rubrics')} : {p.rubrics.map(r => `${r.rubricId} ${r.scale.min}–${r.scale.max} ${t('editor.pass')} ${r.passMark}`).join(' · ')}</p> : null}
        </section>
        <section className="card" aria-labelledby="board"><h2 id="board" className="text-lg font-bold mb-2">{t('editor.board')}</h2>
          <BoardForm users={p.users.filter(u => u.status === 'Active')} board={p.board} onSave={b => run('set-board', { board: b }, 'done.board_saved')} />
          <p className="text-sm mt-2">{t('editor.conflicts')} : {Object.keys(p.conflicts).length}/{p.board.length}{me.userId in p.conflicts ? '' : p.board.some(b => b.userId === me.userId) ? <> · <button className="underline" onClick={() => run('declare-conflict', { conflictedApplicationIds: [] }, 'done.no_conflict')}>{t('editor.declare_none')}</button></> : null}</p>
        </section>
        <section className="card" aria-labelledby="stages"><h2 id="stages" className="text-lg font-bold mb-2">{t('editor.stages')}</h2>
          <ol className="list-decimal pl-5">{p.stages.map(s => <li key={s.stageId}>{s.name[lang]} / <span lang={other}>{s.name[other]}</span> {s.requiresConsensus ? <span className="badge">{t('editor.consensus_badge')}</span> : null} {s.notifies ? <span className="badge">{t('editor.notifies_badge')}</span> : null}</li>)}</ol>
        </section>
        <section className="card lg:col-span-2" aria-labelledby="poster"><h2 id="poster" className="text-lg font-bold mb-2">{t('editor.poster')}</h2>
          <PosterForm langs={langs} poster={p.poster} disabled={!['Draft', 'PendingApproval', 'Approved', 'Scheduled'].includes(p.status)} onSave={(l, body) => run('draft-poster', { lang: l, body }, 'done.poster_saved', { lang: l.toUpperCase() })} />
        </section>
      </div>
      <p className="sr-only">{fmt(new Date(), tz)}</p>
    </>
  );
}

function Completeness({ p }: { p: Detail }) {
  const { t, label } = useI18n();
  const items: string[] = [];
  for (const l of p.org.languages.filter(x => x.required)) {
    if (!p.title[l.code]) items.push(t('editor.missing_title', { lang: l.code.toUpperCase() }));
    if (!p.poster[l.code]) items.push(t('editor.missing_poster', { lang: l.code.toUpperCase() }));
  }
  for (const c of p.criteria.filter(c => c.type === 'essential')) if (!p.plan.some(e => e.criterionCode === c.code)) items.push(t('editor.no_method', { code: c.code }));
  for (const e of p.plan) if (e.method !== 'application' && !e.rubricId) items.push(t('editor.needs_rubric', { code: e.criterionCode, method: label('m', e.method) }));
  if (!p.criteria.some(c => c.type === 'essential')) items.push(t('editor.no_essential'));
  return <section className="card" aria-labelledby="complete"><h2 id="complete" className="text-lg font-bold mb-2">{t('editor.completeness')}</h2>{items.length ? <ul className="list-disc pl-5">{items.map(i => <li key={i}>{i}</li>)}</ul> : <p>{t('editor.ready')}</p>}<p className="text-sm mt-2">{t('processes.applications')} : {Object.entries(p.counts).map(([k, v]) => `${label('as', k)} ${v}`).join(' · ') || t('none')}</p></section>;
}

function ApprovalForm({ onApprove, onReject }: { onApprove: (c: string) => void; onReject: (r: string) => void }) {
  const { t } = useI18n();
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  return <div className="grid gap-2"><Field id="comment" label={t('editor.comment')}><input id="comment" className="input" value={comment} onChange={e => setComment(e.target.value)} /></Field><button className="btn-primary" onClick={() => onApprove(comment)}>{t('editor.approve')}</button><Field id="reject-reason" label={t('editor.reject_reason')}><input id="reject-reason" className="input" value={reason} onChange={e => setReason(e.target.value)} /></Field><button className="btn-danger" onClick={() => onReject(reason)}>{t('editor.reject')}</button></div>;
}

function PublishForm({ tz, onPublish, onSchedule, onReturn }: { tz: string; onPublish: (c: string) => void; onSchedule: (p: string, c: string) => void; onReturn: (r: string) => void }) {
  const { t } = useI18n();
  const [closeAt, setCloseAt] = useState('');
  const [publishAt, setPublishAt] = useState('');
  return <div className="grid gap-2"><Field id="close" label={t('editor.close_time', { tz })} help={t('editor.close_help')}><input id="close" className="input" placeholder="2027-01-25 23:59" value={closeAt} onChange={e => setCloseAt(e.target.value)} /></Field><button className="btn-primary" onClick={() => onPublish(closeAt)}>{t('editor.publish_now')}</button><Field id="publish" label={t('editor.publish_at', { tz })}><input id="publish" className="input" placeholder="2027-01-06 08:00" value={publishAt} onChange={e => setPublishAt(e.target.value)} /></Field><button className="btn-secondary" onClick={() => onSchedule(publishAt, closeAt)}>{t('editor.schedule')}</button><ReasonButton label={t('editor.return_draft')} cls="btn-secondary" onSubmit={onReturn} /></div>;
}

function PostedControls({ p, tz, run, langs }: { p: Detail; tz: string; run: (n: string, b: Record<string, unknown>, d?: StaffKey) => Promise<void>; langs: Array<{ code: 'en' | 'fr' }> }) {
  const { t, fmt } = useI18n();
  const [closeAt, setCloseAt] = useState('');
  const [reason, setReason] = useState('');
  const [amend, setAmend] = useState<Record<string, string>>({ ...p.poster } as Record<string, string>);
  const [amendReason, setAmendReason] = useState('');
  return <div className="grid gap-2">
    <p>{t('editor.closes', { time: p.closeAt ? fmt(p.closeAt, tz) : '', version: p.posterVersion })}</p>
    <Field id="extend" label={t('editor.extend_to', { tz })}><input id="extend" className="input" value={closeAt} onChange={e => setCloseAt(e.target.value)} /></Field>
    <Field id="extend-reason" label={t('reason')}><input id="extend-reason" className="input" value={reason} onChange={e => setReason(e.target.value)} /></Field>
    <div className="flex gap-2"><button className="btn-secondary" onClick={() => run('extend-closing', { closeAt, reason }, 'done.extended')}>{t('editor.extend')}</button><button className="btn-danger" onClick={() => run('close-early', { reason }, 'done.closed_early')}>{t('editor.close_early')}</button></div>
    {langMapInput(amend, setAmend, 'amend', t('editor.amend'), langs, true)}
    <Field id="amend-reason" label={t('editor.amend_reason')}><input id="amend-reason" className="input" value={amendReason} onChange={e => setAmendReason(e.target.value)} /></Field>
    <button className="btn-secondary" onClick={() => run('amend-poster', { poster: amend, reason: amendReason }, 'done.amended')}>{t('editor.amend')}</button>
    <button className="btn-primary" onClick={() => run('release-screening-results', {}, 'done.released')}>{t('editor.release')}</button>
  </div>;
}

function ReasonButton({ label: text, cls, onSubmit, placeholder }: { label: string; cls: string; onSubmit: (r: string) => void; placeholder?: string }) {
  const { t } = useI18n();
  const [r, setR] = useState('');
  const id = text.toLowerCase().replace(/\W+/g, '-');
  return <span className="inline-flex flex-wrap gap-2 items-end mt-2"><span><label htmlFor={id} className="text-sm font-semibold block">{placeholder ?? t('reason')}</label><input id={id} className="input" value={r} onChange={e => setR(e.target.value)} /></span><button type="button" className={cls} onClick={() => onSubmit(r)}>{text}</button></span>;
}

function AddCriterion({ langs, onAdd }: { langs: Array<{ code: 'en' | 'fr' }>; onAdd: (type: string, text: Record<string, string>) => void }) {
  const { t, label } = useI18n();
  const [type, setType] = useState('essential');
  const [text, setText] = useState<Record<string, string>>({});
  return <div className="border-t mt-3 pt-3"><h3 className="font-semibold">{t('editor.add_criterion')}</h3><Field id="ctype" label={t('editor.type')}><select id="ctype" className="input" value={type} onChange={e => setType(e.target.value)}>{['essential', 'asset', 'organizational_need', 'operational_requirement', 'condition_of_employment'].map(x => <option key={x} value={x}>{label('ct', x)}</option>)}</select></Field>{langMapInput(text, setText, 'ctext', t('editor.text'), langs)}<button className="btn-secondary" onClick={() => { onAdd(type, text); setText({}); }}>{t('add')}</button></div>;
}

function AddMethod({ criteria, rubrics, onAdd }: { criteria: string[]; rubrics: string[]; onAdd: (c: string, m: string, r?: string) => void }) {
  const { t, label } = useI18n();
  const [c, setC] = useState(criteria[0] ?? '');
  const [m, setM] = useState('application');
  const [r, setR] = useState('');
  return <div className="border-t mt-3 pt-3 grid gap-2 sm:grid-cols-4 items-end"><Field id="mc" label={t('editor.criterion')}><select id="mc" className="input" value={c} onChange={e => setC(e.target.value)}>{criteria.map(x => <option key={x}>{x}</option>)}</select></Field><Field id="mm" label={t('editor.method')}><select id="mm" className="input" value={m} onChange={e => setM(e.target.value)}>{['application', 'written_exam', 'interview', 'reference_check', 'portfolio', 'sle', 'other'].map(x => <option key={x} value={x}>{label('m', x)}</option>)}</select></Field><Field id="mr" label={t('editor.rubric')}><select id="mr" className="input" value={r} onChange={e => setR(e.target.value)}><option value="">—</option>{rubrics.map(x => <option key={x}>{x}</option>)}</select></Field><button className="btn-secondary mb-4" onClick={() => onAdd(c, m, r || undefined)}>{t('editor.assign_method')}</button></div>;
}

function AddRubric({ langs, onAdd }: { langs: Array<{ code: 'en' | 'fr' }>; onAdd: (r: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const [id, setId] = useState('r1');
  const [name, setName] = useState('0–5');
  const [max, setMax] = useState(5);
  const [pass, setPass] = useState(3);
  const [desc, setDesc] = useState<Record<string, string>>({});
  return <div className="border-t mt-3 pt-3"><h3 className="font-semibold">{t('editor.define_rubric')}</h3><div className="grid sm:grid-cols-4 gap-2"><Field id="rid" label={t('editor.rubric_id')}><input id="rid" className="input" value={id} onChange={e => setId(e.target.value)} /></Field><Field id="rname" label={t('editor.rubric_name')}><input id="rname" className="input" value={name} onChange={e => setName(e.target.value)} /></Field><Field id="rmax" label={t('editor.rubric_max')}><input id="rmax" type="number" className="input" value={max} onChange={e => setMax(+e.target.value)} /></Field><Field id="rpass" label={t('editor.rubric_pass')}><input id="rpass" type="number" className="input" value={pass} onChange={e => setPass(+e.target.value)} /></Field></div>{langMapInput(desc, setDesc, 'rdesc', t('editor.rubric_desc'), langs, true)}<button className="btn-secondary" onClick={() => onAdd({ rubricId: id, name, scale: { min: 0, max }, passMark: pass, descriptors: desc })}>{t('editor.save_rubric')}</button></div>;
}

function AddKnockout({ langs, onAdd }: { langs: Array<{ code: 'en' | 'fr' }>; onAdd: (q: Record<string, string>, expected: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState<Record<string, string>>({});
  const [exp, setExp] = useState('yes');
  return <div className="border-t mt-3 pt-3"><h3 className="font-semibold">{t('editor.add_knockout')}</h3>{langMapInput(q, setQ, 'kq', t('editor.question'), langs)}<Field id="kexp" label={t('editor.expected')}><select id="kexp" className="input" value={exp} onChange={e => setExp(e.target.value)}><option value="yes">{t('yes')}</option><option value="no">{t('no')}</option></select></Field><button className="btn-secondary" onClick={() => { onAdd(q, exp); setQ({}); }}>{t('add')}</button></div>;
}

function BoardForm({ users, board, onSave }: { users: Array<{ userId: string; displayName: string; roles: string[] }>; board: Array<{ userId: string; role: string }>; onSave: (b: Array<{ userId: string; role: string }>) => void }) {
  const { t, label } = useI18n();
  const [b, setB] = useState(board);
  const roleOf = (id: string) => b.find(x => x.userId === id)?.role ?? '';
  return <div><table className="table"><caption className="sr-only">{t('editor.board')}</caption><thead><tr><th scope="col">{t('editor.user')}</th><th scope="col">{t('editor.role')}</th></tr></thead><tbody>{users.map(u => <tr key={u.userId}><td>{u.displayName} <span className="text-xs">({u.roles.map(r => label('role', r)).join(', ')})</span></td><td><select aria-label={t('editor.board_role', { name: u.displayName })} className="input" value={roleOf(u.userId)} onChange={e => setB(prev => [...prev.filter(x => x.userId !== u.userId), ...(e.target.value ? [{ userId: u.userId, role: e.target.value }] : [])])}><option value="">—</option><option value="chair">{t('role.chair')}</option><option value="assessor">{label('role', 'assessor')}</option></select></td></tr>)}</tbody></table><button className="btn-secondary mt-2" onClick={() => onSave(b)}>{t('editor.save_board')}</button></div>;
}

function PosterForm({ langs, poster, disabled, onSave }: { langs: Array<{ code: 'en' | 'fr' }>; poster: Record<string, string | undefined>; disabled: boolean; onSave: (lang: string, body: string) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState<Record<string, string>>({ ...poster } as Record<string, string>);
  return <div>{langs.map(l => <div key={l.code} className="mb-3"><label htmlFor={`poster-${l.code}`} className="label">{l.code.toUpperCase()}</label><textarea id={`poster-${l.code}`} className="input" rows={10} lang={l.code} disabled={disabled} value={v[l.code] ?? ''} onChange={e => setV({ ...v, [l.code]: e.target.value })} /><button className="btn-secondary mt-1" disabled={disabled} onClick={() => onSave(l.code, v[l.code] ?? '')}>{t('editor.save_lang', { lang: l.code.toUpperCase() })}</button></div>)}</div>;
}
