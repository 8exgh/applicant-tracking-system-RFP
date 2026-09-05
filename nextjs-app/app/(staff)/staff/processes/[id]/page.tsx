'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery, langMapInput, Status, Me } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { Field } from '@/components/ui';

type Detail = Awaited<ReturnType<typeof import('@/lib/queries/staff').processDetail>>;

export default function ProcessEditor() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="Process">{me => <Editor id={id} me={me} />}</Shell>;
}

function Editor({ id, me }: { id: string; me: Me }) {
  const { data: p, error, reload } = useQuery<Detail>('process', { processId: id });
  const [status, setStatus] = useState('');
  if (error) return <p role="alert" className="field-error">{error}</p>;
  if (!p) return <p role="status">Loading…</p>;
  const run = async (name: string, body: Record<string, unknown>, done = 'Saved') => {
    try { await staffApi.command(name, { processId: id, ...body }, { expectedVersion: p.version }); setStatus(done); reload(); } catch (e) { setStatus(errorMessage(e)); }
  };
  const editable = p.status === 'Draft';
  const canPublish = me.roles.some(r => ['org_admin', 'hr_advisor'].includes(r));
  const canApprove = me.roles.includes('org_admin');
  const langs = p.org.languages;
  const tz = p.org.timeZone;
  const sub = [['pipeline', 'Pipeline'], ['screening', 'Screening'], ['assessment', 'Assessment'], ['interviews', 'Interviews'], ['timeline', 'Timeline'], ['reports', 'Reports']];
  return (
    <>
      <p className="mb-2"><strong>{p.reference}</strong> · <span className="badge">{p.status}</span> · v{p.version} · {p.title.en || p.title.fr}</p>
      <nav aria-label="Process sections" className="mb-4"><ul className="flex flex-wrap gap-3 list-none p-0 m-0">{sub.map(([s, l]) => <li key={s}><a href={`/staff/processes/${id}/${s}`}>{l}</a></li>)}</ul></nav>
      <Status message={status} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Completeness p={p} />
        <section className="card" aria-labelledby="approval"><h2 id="approval" className="text-lg font-bold mb-2">Approval and posting</h2>
          {p.status === 'Draft' ? <button className="btn-primary" onClick={() => run('request-approval', {}, 'Approval requested')}>Request approval</button> : null}
          {p.status === 'PendingApproval' && canApprove ? <ApprovalForm onApprove={c => run('approve-process', { comment: c }, 'Approved')} onReject={r => run('reject-process', { reason: r }, 'Rejected')} /> : null}
          {p.status === 'PendingApproval' && !canApprove ? <p>Awaiting approval by an organization administrator.</p> : null}
          {['Approved', 'Scheduled'].includes(p.status) && canPublish ? <PublishForm tz={tz} onPublish={c => run('publish-posting', { closeAt: c }, 'Published')} onSchedule={(pa, c) => run('schedule-posting', { publishAt: pa, closeAt: c }, 'Scheduled')} onReturn={r => run('return-to-draft', { reason: r }, 'Returned to draft')} /> : null}
          {p.status === 'Posted' && canPublish ? <PostedControls p={p} tz={tz} run={run} langs={langs} /> : null}
          {p.status === 'Closed' && canPublish ? <button className="btn-primary" onClick={() => run('complete-process', {}, 'Completed')}>Mark completed</button> : null}
          {!['Completed', 'Cancelled'].includes(p.status) && canPublish ? <ReasonButton label="Cancel process" cls="btn-danger" onSubmit={r => run('cancel-process', { reason: r }, 'Cancelled')} /> : null}
          <p className="mt-3"><ReasonButton label="Clone as new draft" cls="btn-secondary" onSubmit={t => staffApi.command('clone-process', { processId: id, title: { en: t } }).then(r => { location.href = `/staff/processes/${r.processId}`; }).catch(e => setStatus(errorMessage(e)))} placeholder="New title (EN)" /></p>
        </section>
        <section className="card" aria-labelledby="criteria"><h2 id="criteria" className="text-lg font-bold mb-2">Merit criteria and assessment plan</h2>
          <table className="table"><caption className="sr-only">Criteria</caption><thead><tr><th scope="col">Code</th><th scope="col">Type</th><th scope="col">Text</th><th scope="col">Methods</th></tr></thead><tbody>
            {p.criteria.map(c => <tr key={c.code}><td>{c.code}</td><td>{c.type}</td><td>{c.text.en}<br /><span lang="fr">{c.text.fr}</span></td><td>{p.plan.filter(e => e.criterionCode === c.code).map(e => <span key={e.method} className="badge mr-1">{e.method}{e.rubricId ? ` (${e.rubricId})` : ''}{editable ? <button type="button" className="ml-1 underline" aria-label={`Remove ${e.method} from ${c.code}`} onClick={() => run('remove-assessment-method', { criterionCode: c.code, method: e.method })}>×</button> : null}</span>)}{editable ? <button type="button" className="underline text-sm" aria-label={`Remove criterion ${c.code}`} onClick={() => run('remove-criterion', { code: c.code })}>remove</button> : null}</td></tr>)}
          </tbody></table>
          {editable ? <><AddCriterion langs={langs} onAdd={(type, text) => run('add-criterion', { type, text }, 'Criterion added')} /><AddMethod criteria={p.criteria.map(c => c.code)} rubrics={p.rubrics.map(r => r.rubricId)} onAdd={(criterionCode, method, rubricId) => run('assign-assessment-method', { criterionCode, method, rubricId }, 'Method assigned')} /><AddRubric langs={langs} onAdd={r => run('define-rubric', r, 'Rubric defined')} /><AddKnockout langs={langs} onAdd={(q, exp) => run('add-knockout', { question: q, expected: exp }, 'Knockout added')} /></> : <p className="help">Criteria and plan are locked from approval onward. Return to draft to change them.</p>}
          {p.knockouts.length ? <p className="mt-2 text-sm">Knockouts: {p.knockouts.map(k => `${k.code} (${k.expected})`).join(', ')}</p> : null}
          {p.rubrics.length ? <p className="text-sm">Rubrics: {p.rubrics.map(r => `${r.rubricId} ${r.scale.min}–${r.scale.max} pass ${r.passMark}`).join(' · ')}</p> : null}
        </section>
        <section className="card" aria-labelledby="board"><h2 id="board" className="text-lg font-bold mb-2">Board</h2>
          <BoardForm users={p.users.filter(u => u.status === 'Active')} board={p.board} onSave={b => run('set-board', { board: b }, 'Board saved')} />
          <p className="text-sm mt-2">Conflicts declared: {Object.keys(p.conflicts).length}/{p.board.length}{me.userId in p.conflicts ? '' : p.board.some(b => b.userId === me.userId) ? <> · <button className="underline" onClick={() => run('declare-conflict', { conflictedApplicationIds: [] }, 'Declared no conflict')}>Declare no conflict</button></> : null}</p>
        </section>
        <section className="card" aria-labelledby="stages"><h2 id="stages" className="text-lg font-bold mb-2">Stages</h2>
          <ol className="list-decimal pl-5">{p.stages.map(s => <li key={s.stageId}>{s.name.en} / <span lang="fr">{s.name.fr}</span> {s.requiresConsensus ? <span className="badge">consensus</span> : null} {s.notifies ? <span className="badge">notifies</span> : null}</li>)}</ol>
        </section>
        <section className="card lg:col-span-2" aria-labelledby="poster"><h2 id="poster" className="text-lg font-bold mb-2">Poster</h2>
          <PosterForm langs={langs} poster={p.poster} disabled={!['Draft', 'PendingApproval', 'Approved', 'Scheduled'].includes(p.status)} onSave={(lang, body) => run('draft-poster', { lang, body }, `Poster (${lang}) saved`)} />
        </section>
      </div>
    </>
  );
}

function Completeness({ p }: { p: Detail }) {
  const items: string[] = [];
  for (const l of p.org.languages.filter(x => x.required)) {
    if (!p.title[l.code]) items.push(`${l.code.toUpperCase()}: title missing`);
    if (!p.poster[l.code]) items.push(`${l.code.toUpperCase()}: poster body missing`);
  }
  for (const c of p.criteria.filter(c => c.type === 'essential')) if (!p.plan.some(e => e.criterionCode === c.code)) items.push(`${c.code}: no assessment method`);
  for (const e of p.plan) if (e.method !== 'application' && !e.rubricId) items.push(`${e.criterionCode}: ${e.method} needs a rubric`);
  if (!p.criteria.some(c => c.type === 'essential')) items.push('No essential criterion');
  return <section className="card" aria-labelledby="complete"><h2 id="complete" className="text-lg font-bold mb-2">Completeness</h2>{items.length ? <ul className="list-disc pl-5">{items.map(i => <li key={i}>{i}</li>)}</ul> : <p>Ready for approval and publishing.</p>}<p className="text-sm mt-2">Applications: {Object.entries(p.counts).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}</p></section>;
}

function ApprovalForm({ onApprove, onReject }: { onApprove: (c: string) => void; onReject: (r: string) => void }) {
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  return <div className="grid gap-2"><Field id="comment" label="Comment"><input id="comment" className="input" value={comment} onChange={e => setComment(e.target.value)} /></Field><button className="btn-primary" onClick={() => onApprove(comment)}>Approve</button><Field id="reject-reason" label="Rejection reason"><input id="reject-reason" className="input" value={reason} onChange={e => setReason(e.target.value)} /></Field><button className="btn-danger" onClick={() => onReject(reason)}>Reject</button></div>;
}

function PublishForm({ tz, onPublish, onSchedule, onReturn }: { tz: string; onPublish: (c: string) => void; onSchedule: (p: string, c: string) => void; onReturn: (r: string) => void }) {
  const [closeAt, setCloseAt] = useState('');
  const [publishAt, setPublishAt] = useState('');
  return <div className="grid gap-2"><Field id="close" label={`Closing time (${tz})`} help="YYYY-MM-DD HH:MM in the organization's time zone"><input id="close" className="input" placeholder="2027-01-25 23:59" value={closeAt} onChange={e => setCloseAt(e.target.value)} /></Field><button className="btn-primary" onClick={() => onPublish(closeAt)}>Publish now</button><Field id="publish" label={`Publish at (${tz})`}><input id="publish" className="input" placeholder="2027-01-06 08:00" value={publishAt} onChange={e => setPublishAt(e.target.value)} /></Field><button className="btn-secondary" onClick={() => onSchedule(publishAt, closeAt)}>Schedule</button><ReasonButton label="Return to draft" cls="btn-secondary" onSubmit={onReturn} /></div>;
}

function PostedControls({ p, tz, run, langs }: { p: Detail; tz: string; run: (n: string, b: Record<string, unknown>, d?: string) => Promise<void>; langs: Array<{ code: 'en' | 'fr' }> }) {
  const [closeAt, setCloseAt] = useState('');
  const [reason, setReason] = useState('');
  const [amend, setAmend] = useState<Record<string, string>>({ ...p.poster } as Record<string, string>);
  const [amendReason, setAmendReason] = useState('');
  return <div className="grid gap-2">
    <p>Closes {p.closeAt ? new Date(p.closeAt).toLocaleString('en-CA', { timeZone: tz, timeZoneName: 'short' }) : ''} · poster v{p.posterVersion}</p>
    <Field id="extend" label={`Extend closing to (${tz})`}><input id="extend" className="input" value={closeAt} onChange={e => setCloseAt(e.target.value)} /></Field>
    <Field id="extend-reason" label="Reason"><input id="extend-reason" className="input" value={reason} onChange={e => setReason(e.target.value)} /></Field>
    <div className="flex gap-2"><button className="btn-secondary" onClick={() => run('extend-closing', { closeAt, reason }, 'Extended')}>Extend</button><button className="btn-danger" onClick={() => run('close-early', { reason }, 'Closed early')}>Close early</button></div>
    {langMapInput(amend, setAmend, 'amend', 'Amend poster', langs, true)}
    <Field id="amend-reason" label="Amendment reason"><input id="amend-reason" className="input" value={amendReason} onChange={e => setAmendReason(e.target.value)} /></Field>
    <button className="btn-secondary" onClick={() => run('amend-poster', { poster: amend, reason: amendReason }, 'Amended')}>Amend poster</button>
    <button className="btn-primary" onClick={() => run('release-screening-results', {}, 'Screening results released')}>Release screening results</button>
  </div>;
}

function ReasonButton({ label, cls, onSubmit, placeholder = 'Reason' }: { label: string; cls: string; onSubmit: (r: string) => void; placeholder?: string }) {
  const [r, setR] = useState('');
  const id = label.toLowerCase().replace(/\W+/g, '-');
  return <span className="inline-flex flex-wrap gap-2 items-end mt-2"><span><label htmlFor={id} className="text-sm font-semibold block">{placeholder}</label><input id={id} className="input" value={r} onChange={e => setR(e.target.value)} /></span><button type="button" className={cls} onClick={() => onSubmit(r)}>{label}</button></span>;
}

function AddCriterion({ langs, onAdd }: { langs: Array<{ code: 'en' | 'fr' }>; onAdd: (type: string, text: Record<string, string>) => void }) {
  const [type, setType] = useState('essential');
  const [text, setText] = useState<Record<string, string>>({});
  return <div className="border-t mt-3 pt-3"><h3 className="font-semibold">Add criterion</h3><Field id="ctype" label="Type"><select id="ctype" className="input" value={type} onChange={e => setType(e.target.value)}>{['essential', 'asset', 'organizational_need', 'operational_requirement', 'condition_of_employment'].map(t => <option key={t}>{t}</option>)}</select></Field>{langMapInput(text, setText, 'ctext', 'Text', langs)}<button className="btn-secondary" onClick={() => { onAdd(type, text); setText({}); }}>Add</button></div>;
}

function AddMethod({ criteria, rubrics, onAdd }: { criteria: string[]; rubrics: string[]; onAdd: (c: string, m: string, r?: string) => void }) {
  const [c, setC] = useState(criteria[0] ?? '');
  const [m, setM] = useState('application');
  const [r, setR] = useState('');
  return <div className="border-t mt-3 pt-3 grid gap-2 sm:grid-cols-4 items-end"><Field id="mc" label="Criterion"><select id="mc" className="input" value={c} onChange={e => setC(e.target.value)}>{criteria.map(x => <option key={x}>{x}</option>)}</select></Field><Field id="mm" label="Method"><select id="mm" className="input" value={m} onChange={e => setM(e.target.value)}>{['application', 'written_exam', 'interview', 'reference_check', 'portfolio', 'sle', 'other'].map(x => <option key={x}>{x}</option>)}</select></Field><Field id="mr" label="Rubric"><select id="mr" className="input" value={r} onChange={e => setR(e.target.value)}><option value="">—</option>{rubrics.map(x => <option key={x}>{x}</option>)}</select></Field><button className="btn-secondary mb-4" onClick={() => onAdd(c, m, r || undefined)}>Assign method</button></div>;
}

function AddRubric({ langs, onAdd }: { langs: Array<{ code: 'en' | 'fr' }>; onAdd: (r: Record<string, unknown>) => void }) {
  const [id, setId] = useState('r1');
  const [name, setName] = useState('0–5 competency scale');
  const [max, setMax] = useState(5);
  const [pass, setPass] = useState(3);
  const [desc, setDesc] = useState<Record<string, string>>({});
  return <div className="border-t mt-3 pt-3"><h3 className="font-semibold">Define rubric</h3><div className="grid sm:grid-cols-4 gap-2"><Field id="rid" label="Id"><input id="rid" className="input" value={id} onChange={e => setId(e.target.value)} /></Field><Field id="rname" label="Name"><input id="rname" className="input" value={name} onChange={e => setName(e.target.value)} /></Field><Field id="rmax" label="Max"><input id="rmax" type="number" className="input" value={max} onChange={e => setMax(+e.target.value)} /></Field><Field id="rpass" label="Pass mark"><input id="rpass" type="number" className="input" value={pass} onChange={e => setPass(+e.target.value)} /></Field></div>{langMapInput(desc, setDesc, 'rdesc', 'Level descriptors', langs, true)}<button className="btn-secondary" onClick={() => onAdd({ rubricId: id, name, scale: { min: 0, max }, passMark: pass, descriptors: desc })}>Save rubric</button></div>;
}

function AddKnockout({ langs, onAdd }: { langs: Array<{ code: 'en' | 'fr' }>; onAdd: (q: Record<string, string>, expected: string) => void }) {
  const [q, setQ] = useState<Record<string, string>>({});
  const [exp, setExp] = useState('yes');
  return <div className="border-t mt-3 pt-3"><h3 className="font-semibold">Add knockout question</h3>{langMapInput(q, setQ, 'kq', 'Question', langs)}<Field id="kexp" label="Expected answer"><select id="kexp" className="input" value={exp} onChange={e => setExp(e.target.value)}><option value="yes">yes</option><option value="no">no</option></select></Field><button className="btn-secondary" onClick={() => { onAdd(q, exp); setQ({}); }}>Add knockout</button></div>;
}

function BoardForm({ users, board, onSave }: { users: Array<{ userId: string; displayName: string; roles: string[] }>; board: Array<{ userId: string; role: string }>; onSave: (b: Array<{ userId: string; role: string }>) => void }) {
  const [b, setB] = useState(board);
  const roleOf = (id: string) => b.find(x => x.userId === id)?.role ?? '';
  return <div><table className="table"><caption className="sr-only">Board members</caption><thead><tr><th scope="col">User</th><th scope="col">Role</th></tr></thead><tbody>{users.map(u => <tr key={u.userId}><td>{u.displayName} <span className="text-xs">({u.roles.join(', ')})</span></td><td><select aria-label={`Board role for ${u.displayName}`} className="input" value={roleOf(u.userId)} onChange={e => setB(prev => [...prev.filter(x => x.userId !== u.userId), ...(e.target.value ? [{ userId: u.userId, role: e.target.value }] : [])])}><option value="">—</option><option value="chair">chair</option><option value="assessor">assessor</option></select></td></tr>)}</tbody></table><button className="btn-secondary mt-2" onClick={() => onSave(b)}>Save board</button></div>;
}

function PosterForm({ langs, poster, disabled, onSave }: { langs: Array<{ code: 'en' | 'fr' }>; poster: Record<string, string | undefined>; disabled: boolean; onSave: (lang: string, body: string) => void }) {
  const [v, setV] = useState<Record<string, string>>({ ...poster } as Record<string, string>);
  return <div>{langs.map(l => <div key={l.code} className="mb-3"><label htmlFor={`poster-${l.code}`} className="label">{l.code.toUpperCase()}</label><textarea id={`poster-${l.code}`} className="input" rows={10} lang={l.code} disabled={disabled} value={v[l.code] ?? ''} onChange={e => setV({ ...v, [l.code]: e.target.value })} /><button className="btn-secondary mt-1" disabled={disabled} onClick={() => onSave(l.code, v[l.code] ?? '')}>Save {l.code.toUpperCase()}</button></div>)}</div>;
}
