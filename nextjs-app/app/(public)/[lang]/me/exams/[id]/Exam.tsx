'use client';

import { useEffect, useRef, useState } from 'react';
import { candidateApi, errorMessage } from '@/lib/ui/client-api';
import { LiveStatus, Banner, Field } from '@/components/ui';
import { formatDateTime } from '@/lib/i18n/format';

type ExamData = NonNullable<Awaited<ReturnType<typeof import('@/lib/queries/candidate').applicationForm>>['exam']>;

// Timed exam: visible timer announced at 10 and 5 minutes remaining, autosave (F11)
export function Exam({ locale, applicationId, exam, question, timeZone }: { locale: 'en' | 'fr'; applicationId: string; exam: ExamData; question: string; timeZone: string }) {
  const [deadline, setDeadline] = useState<string | null>(exam.deadline);
  const [answer, setAnswer] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [announce, setAnnounce] = useState('');
  const [done, setDone] = useState(!!exam.submittedAt);
  const announced = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!deadline || done) return;
    const tick = () => {
      const ms = new Date(deadline).getTime() - Date.now();
      const min = Math.max(0, Math.ceil(ms / 60_000));
      setRemaining(min);
      for (const m of [10, 5]) if (min === m && !announced.current.has(m)) { announced.current.add(m); setAnnounce(locale === 'fr' ? `${m} minutes restantes` : `${m} minutes remaining`); }
    };
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [deadline, done, locale]);
  async function start() {
    try { const r = await candidateApi.command('start-exam', { applicationId }); setDeadline(r.deadline); } catch (e) { setStatus(errorMessage(e)); }
  }
  async function submit() {
    try { const r = await candidateApi.command('submit-exam', { applicationId, answers: { [exam.criterionCode]: answer } }); setDone(true); setStatus(r.late ? (locale === 'fr' ? 'Soumis en retard; un membre des RH examinera la situation.' : 'Submitted late; HR will review.') : (locale === 'fr' ? 'Examen soumis.' : 'Exam submitted.')); } catch (e) { setStatus(errorMessage(e)); }
  }
  return (
    <>
      <h1 className="text-2xl font-bold mb-2">{locale === 'fr' ? 'Examen écrit' : 'Written exam'}: {exam.criterionCode}</h1>
      <p className="mb-3">{locale === 'fr' ? 'Fenêtre' : 'Window'}: {formatDateTime(exam.windowStart, locale, timeZone)} – {formatDateTime(exam.windowEnd, locale, timeZone)} · {exam.limitMinutes} min</p>
      {done ? <Banner kind="success">{status || (locale === 'fr' ? 'Examen soumis.' : 'Exam submitted.')}</Banner> : !deadline ? (
        <button type="button" className="btn-primary" onClick={start}>{locale === 'fr' ? 'Commencer l’examen' : 'Start the exam'}</button>
      ) : (
        <>
          <p className="font-semibold mb-3" aria-live="off">{locale === 'fr' ? 'Temps restant' : 'Time remaining'}: {remaining ?? '…'} min</p>
          <Field id="answer" label={question}><textarea id="answer" className="input" rows={12} value={answer} onChange={e => setAnswer(e.target.value)} /></Field>
          <button type="button" className="btn-primary" onClick={submit}>{locale === 'fr' ? 'Soumettre' : 'Submit'}</button>
        </>
      )}
      <div role="status" aria-live="assertive" className="sr-only">{announce}</div>
      <LiveStatus message={status} />
    </>
  );
}
