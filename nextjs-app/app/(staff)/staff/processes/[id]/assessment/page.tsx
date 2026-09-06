'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery, Status, useI18n, pick } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';

type Workbook = Awaited<ReturnType<typeof import('@/lib/queries/staff').assessmentWorkbook>>;

export default function Assessment() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="assessment.title">{me => <WorkbookView id={id} userId={me.userId} />}</Shell>;
}

// Per-assessor workbook (F11): own scores, submit, and the chair's consensus view
function WorkbookView({ id, userId }: { id: string; userId: string }) {
  const { t, lang, label } = useI18n();
  const { data, error, reload } = useQuery<Workbook>('assessment-workbook', { processId: id });
  const [status, setStatus] = useState('');
  if (error) return <p role="alert" className="field-error">{error}</p>;
  if (!data) return <p role="status">{t('loading')}</p>;
  const scored = data.plan.filter(e => e.method !== 'application');
  const isChair = data.board.find(b => b.userId === userId)?.role === 'chair';
  const run = async (name: string, body: Record<string, unknown>, done: string) => { try { await staffApi.command(name, body); setStatus(done); reload(); } catch (e) { setStatus(errorMessage(e)); } };
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${id}`}>{data.reference}</a> · {pick(data.title, lang)}</p>
      {!data.conflictDeclared && data.board.some(b => b.userId === userId) ? <p className="card mb-3">{t('assessment.declare')} <button className="btn-primary ml-2" onClick={() => run('declare-conflict', { processId: id, conflictedApplicationIds: [] }, t('done.no_conflict'))}>{t('assessment.no_conflict')}</button> <span className="text-sm">{t('assessment.declare_hint')}</span></p> : null}
      <Status message={status} />
      {data.items.map(item => (
        <section key={item.applicationId} className="card mb-3" aria-labelledby={`a-${item.applicationId}`}>
          <h2 id={`a-${item.applicationId}`} className="font-bold"><a href={`/staff/applications/${item.applicationId}`}>{item.name}</a> <span className="badge">{label('as', item.status)}</span>{item.qualified === true ? <span className="badge ml-1">{t('pipeline.qualified')}</span> : item.qualified === false ? <span className="badge ml-1">{t('assessment.not_qualified')}</span> : null}</h2>
          <table className="table mt-2"><caption className="sr-only">{t('assessment.scores')}</caption><thead><tr><th scope="col">{t('editor.criterion')}</th><th scope="col">{t('editor.method')}</th><th scope="col">{t('assessment.my_score')}</th><th scope="col">{t('assessment.evidence')}</th><th scope="col">{t('assessment.consensus')}</th></tr></thead><tbody>
            {scored.map(e => <ScoreRow key={`${e.criterionCode}-${e.method}`} applicationId={item.applicationId} criterionCode={e.criterionCode} method={e.method} rubric={data.rubrics.find(r => r.rubricId === e.rubricId)} mine={item.mine[e.criterionCode]} consensus={item.consensus[e.criterionCode]} disagreement={item.disagreements.includes(e.criterionCode)} submitted={item.submitted} isChair={isChair} onDone={m => { setStatus(m); reload(); }} />)}
          </tbody></table>
          <p className="text-sm mt-2">{t('assessment.submitted')} : {item.assessorsSubmitted.length}/{item.assessorsRequired.length} {item.submitted ? t('assessment.you_submitted') : <button className="btn-primary ml-2" onClick={() => run('submit-scores', { applicationId: item.applicationId }, t('assessment.scores_submitted'))}>{t('assessment.submit')}</button>}</p>
        </section>
      ))}
    </>
  );
}

function ScoreRow({ applicationId, criterionCode, method, rubric, mine, consensus, disagreement, submitted, isChair, onDone }: { applicationId: string; criterionCode: string; method: string; rubric?: { scale: { min: number; max: number }; passMark: number }; mine?: { score: number; evidence: string }; consensus?: { score: number; pass: boolean; note?: string }; disagreement: boolean; submitted: boolean; isChair: boolean; onDone: (m: string) => void }) {
  const { t, label } = useI18n();
  const [score, setScore] = useState(mine?.score ?? rubric?.scale.min ?? 0);
  const [evidence, setEvidence] = useState(mine?.evidence ?? '');
  const [reason, setReason] = useState('');
  const [cScore, setCScore] = useState(consensus?.score ?? rubric?.scale.min ?? 0);
  const [cNote, setCNote] = useState('');
  const [cReason, setCReason] = useState('');
  const save = async () => { try { await staffApi.command('record-score', { applicationId, criterionCode, method, score, evidence, reason: reason || undefined }); onDone(t('assessment.score_saved', { code: criterionCode })); } catch (e) { onDone(errorMessage(e)); } };
  const saveConsensus = async () => { try { await staffApi.command('record-consensus', { applicationId, criterionCode, score: cScore, note: cNote || undefined, reason: cReason || undefined }); onDone(t('assessment.consensus_saved', { code: criterionCode })); } catch (e) { onDone(errorMessage(e)); } };
  const idp = `${applicationId.slice(0, 6)}-${criterionCode}`;
  return (
    <tr>
      <td>{criterionCode}{disagreement ? <span className="badge ml-1">{t('assessment.disagreement')}</span> : null}</td>
      <td>{label('m', method)}</td>
      <td>{consensus ? mine?.score ?? '—' : <><label htmlFor={`s-${idp}`} className="sr-only">{t('assessment.score_for', { code: criterionCode })}</label><input id={`s-${idp}`} type="number" className="input w-20" min={rubric?.scale.min} max={rubric?.scale.max} value={score} onChange={e => setScore(+e.target.value)} disabled={submitted && !mine} /></>}</td>
      <td>{consensus ? mine?.evidence ?? '' : <><label htmlFor={`e-${idp}`} className="sr-only">{t('assessment.evidence_for', { code: criterionCode })}</label><textarea id={`e-${idp}`} className="input" rows={2} value={evidence} onChange={e => setEvidence(e.target.value)} />{mine ? <><label htmlFor={`r-${idp}`} className="sr-only">{t('assessment.amendment_reason')}</label><input id={`r-${idp}`} className="input mt-1" placeholder={t('assessment.amend_reason')} value={reason} onChange={e => setReason(e.target.value)} /></> : null}<button className="btn-secondary mt-1" onClick={save}>{mine ? t('assessment.amend') : t('assessment.record')}</button></>}</td>
      <td>{consensus ? <span>{consensus.score} — {consensus.pass ? t('assessment.pass') : t('assessment.fail')}{consensus.note ? ` (${consensus.note})` : ''}</span> : null}
        {isChair ? <div className="mt-1"><label htmlFor={`c-${idp}`} className="sr-only">{t('assessment.consensus_score')}</label><input id={`c-${idp}`} type="number" className="input w-20 inline-block" min={rubric?.scale.min} max={rubric?.scale.max} value={cScore} onChange={e => setCScore(+e.target.value)} /> <label htmlFor={`cn-${idp}`} className="sr-only">{t('assessment.note')}</label><input id={`cn-${idp}`} className="input inline-block w-40" placeholder={t('assessment.note')} value={cNote} onChange={e => setCNote(e.target.value)} />{consensus ? <><label htmlFor={`cr-${idp}`} className="sr-only">{t('assessment.reason_new')}</label><input id={`cr-${idp}`} className="input inline-block w-40" placeholder={t('assessment.supersede_reason')} value={cReason} onChange={e => setCReason(e.target.value)} /></> : null} <button className="btn-secondary" onClick={saveConsensus}>{t('assessment.consensus')}</button></div> : null}</td>
    </tr>
  );
}
