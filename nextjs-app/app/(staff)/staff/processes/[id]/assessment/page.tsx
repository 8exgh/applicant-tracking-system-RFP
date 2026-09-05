'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, useQuery, Status } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';

type Workbook = Awaited<ReturnType<typeof import('@/lib/queries/staff').assessmentWorkbook>>;

export default function Assessment() {
  const { id } = useParams<{ id: string }>();
  return <Shell title="Assessment workbook">{me => <WorkbookView id={id} userId={me.userId} />}</Shell>;
}

// Per-assessor workbook (F11): own scores, submit, and the chair's consensus view
function WorkbookView({ id, userId }: { id: string; userId: string }) {
  const { data, error, reload } = useQuery<Workbook>('assessment-workbook', { processId: id });
  const [status, setStatus] = useState('');
  if (error) return <p role="alert" className="field-error">{error}</p>;
  if (!data) return <p role="status">Loading…</p>;
  const scored = data.plan.filter(e => e.method !== 'application');
  const isChair = data.board.find(b => b.userId === userId)?.role === 'chair';
  const run = async (name: string, body: Record<string, unknown>, done: string) => { try { await staffApi.command(name, body); setStatus(done); reload(); } catch (e) { setStatus(errorMessage(e)); } };
  return (
    <>
      <p className="mb-2"><a href={`/staff/processes/${id}`}>{data.reference}</a> · {data.title.en}</p>
      {!data.conflictDeclared && data.board.some(b => b.userId === userId) ? <p className="card mb-3">Declare conflicts of interest before scoring: <button className="btn-primary ml-2" onClick={() => run('declare-conflict', { processId: id, conflictedApplicationIds: [] }, 'Declared no conflict')}>No conflict</button> <span className="text-sm">(name conflicted candidates on their application page)</span></p> : null}
      <Status message={status} />
      {data.items.map(item => (
        <section key={item.applicationId} className="card mb-3" aria-labelledby={`a-${item.applicationId}`}>
          <h2 id={`a-${item.applicationId}`} className="font-bold"><a href={`/staff/applications/${item.applicationId}`}>{item.name}</a> <span className="badge">{item.status}</span>{item.qualified === true ? <span className="badge ml-1">qualified</span> : item.qualified === false ? <span className="badge ml-1">not qualified</span> : null}</h2>
          <table className="table mt-2"><caption className="sr-only">Scores</caption><thead><tr><th scope="col">Criterion</th><th scope="col">Method</th><th scope="col">My score</th><th scope="col">Evidence</th><th scope="col">Consensus</th></tr></thead><tbody>
            {scored.map(e => {
              const mine = item.mine[e.criterionCode];
              const cons = item.consensus[e.criterionCode];
              return <ScoreRow key={`${e.criterionCode}-${e.method}`} applicationId={item.applicationId} criterionCode={e.criterionCode} method={e.method} rubric={data.rubrics.find(r => r.rubricId === e.rubricId)} mine={mine} consensus={cons} disagreement={item.disagreements.includes(e.criterionCode)} submitted={item.submitted} isChair={isChair} onDone={m => { setStatus(m); reload(); }} />;
            })}
          </tbody></table>
          <p className="text-sm mt-2">Submitted: {item.assessorsSubmitted.length}/{item.assessorsRequired.length} {item.submitted ? '(you have submitted)' : <button className="btn-primary ml-2" onClick={() => run('submit-scores', { applicationId: item.applicationId }, 'Scores submitted')}>Submit my scores</button>}</p>
        </section>
      ))}
    </>
  );
}

function ScoreRow({ applicationId, criterionCode, method, rubric, mine, consensus, disagreement, submitted, isChair, onDone }: { applicationId: string; criterionCode: string; method: string; rubric?: { scale: { min: number; max: number }; passMark: number }; mine?: { score: number; evidence: string }; consensus?: { score: number; pass: boolean; note?: string }; disagreement: boolean; submitted: boolean; isChair: boolean; onDone: (m: string) => void }) {
  const [score, setScore] = useState(mine?.score ?? rubric?.scale.min ?? 0);
  const [evidence, setEvidence] = useState(mine?.evidence ?? '');
  const [reason, setReason] = useState('');
  const [cScore, setCScore] = useState(consensus?.score ?? rubric?.scale.min ?? 0);
  const [cNote, setCNote] = useState('');
  const [cReason, setCReason] = useState('');
  const save = async () => { try { await staffApi.command('record-score', { applicationId, criterionCode, method, score, evidence, reason: reason || undefined }); onDone(`Score saved for ${criterionCode}`); } catch (e) { onDone(errorMessage(e)); } };
  const saveConsensus = async () => { try { await staffApi.command('record-consensus', { applicationId, criterionCode, score: cScore, note: cNote || undefined, reason: cReason || undefined }); onDone(`Consensus recorded for ${criterionCode}`); } catch (e) { onDone(errorMessage(e)); } };
  const idp = `${applicationId.slice(0, 6)}-${criterionCode}`;
  return (
    <tr>
      <td>{criterionCode}{disagreement ? <span className="badge ml-1">High disagreement</span> : null}</td>
      <td>{method}</td>
      <td>{consensus ? mine?.score ?? '—' : <><label htmlFor={`s-${idp}`} className="sr-only">Score for {criterionCode}</label><input id={`s-${idp}`} type="number" className="input w-20" min={rubric?.scale.min} max={rubric?.scale.max} value={score} onChange={e => setScore(+e.target.value)} disabled={submitted && !mine} /></>}</td>
      <td>{consensus ? mine?.evidence ?? '' : <><label htmlFor={`e-${idp}`} className="sr-only">Evidence for {criterionCode}</label><textarea id={`e-${idp}`} className="input" rows={2} value={evidence} onChange={e => setEvidence(e.target.value)} />{mine ? <><label htmlFor={`r-${idp}`} className="sr-only">Amendment reason</label><input id={`r-${idp}`} className="input mt-1" placeholder="Reason to amend" value={reason} onChange={e => setReason(e.target.value)} /></> : null}<button className="btn-secondary mt-1" onClick={save}>{mine ? 'Amend' : 'Record'}</button></>}</td>
      <td>{consensus ? <span>{consensus.score} — {consensus.pass ? 'Pass' : 'Fail'}{consensus.note ? ` (${consensus.note})` : ''}</span> : null}
        {isChair ? <div className="mt-1"><label htmlFor={`c-${idp}`} className="sr-only">Consensus score</label><input id={`c-${idp}`} type="number" className="input w-20 inline-block" min={rubric?.scale.min} max={rubric?.scale.max} value={cScore} onChange={e => setCScore(+e.target.value)} /> <label htmlFor={`cn-${idp}`} className="sr-only">Note</label><input id={`cn-${idp}`} className="input inline-block w-40" placeholder="Note" value={cNote} onChange={e => setCNote(e.target.value)} />{consensus ? <><label htmlFor={`cr-${idp}`} className="sr-only">Reason for new consensus</label><input id={`cr-${idp}`} className="input inline-block w-40" placeholder="Reason (supersede)" value={cReason} onChange={e => setCReason(e.target.value)} /></> : null} <button className="btn-secondary" onClick={saveConsensus}>Consensus</button></div> : null}</td>
    </tr>
  );
}
