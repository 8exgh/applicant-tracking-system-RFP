'use client';

import { useEffect, useRef, useState } from 'react';
import { candidateApi, errorMessage } from '@/lib/ui/client-api';
import { ErrorSummary, Field, LiveStatus, Banner } from '@/components/ui';
import type { MessageKey } from '@/lib/i18n/messages';

type Form = Awaited<ReturnType<typeof import('@/lib/queries/candidate').applicationForm>>;
const LIMIT = 2000;
const EE_GROUPS = [['women', 'Women', 'Femmes'], ['indigenous_peoples', 'Indigenous peoples', 'Peuples autochtones'], ['persons_with_disabilities', 'Persons with disabilities', 'Personnes en situation de handicap'], ['visible_minorities', 'Visible minorities', 'Minorités visibles']] as const;

export function ApplicationForm({ locale, form, labels, closedText, confirmText }: { locale: 'en' | 'fr'; form: Form; labels: Record<MessageKey, string>; closedText: string; confirmText: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>(form.answers as Record<string, string>);
  const [consent, setConsent] = useState(form.consentGiven);
  const [errors, setErrors] = useState<Array<{ id: string; message: string }>>([]);
  const [status, setStatus] = useState('');
  const [submitted, setSubmitted] = useState<null | { version: number }>(null);
  const [documents, setDocuments] = useState(form.documents);
  const [eeGroups, setEeGroups] = useState<string[]>([]);
  const [eeDone, setEeDone] = useState(form.hasSelfDeclaration);
  const [accText, setAccText] = useState('');
  const [note, setNote] = useState('');
  const dirty = useRef(false);
  const editable = form.acceptingEdits;

  // Autosave 30 s after the last change with a polite announcement (F07)
  useEffect(() => {
    if (!editable || !dirty.current) return;
    const timer = setTimeout(async () => {
      try { await candidateApi.command('save-answers', { applicationId: form.applicationId, answers }); setStatus(labels['form.saved']); dirty.current = false; } catch (e) { setStatus(errorMessage(e)); }
    }, 30_000);
    return () => clearTimeout(timer);
  }, [answers, editable, form.applicationId, labels]);

  const set = (k: string, v: string) => { dirty.current = true; setAnswers(a => ({ ...a, [k]: v })); };

  async function saveDraft() {
    try { await candidateApi.command('save-answers', { applicationId: form.applicationId, answers }); setStatus(labels['form.saved']); dirty.current = false; } catch (e) { setStatus(errorMessage(e)); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Array<{ id: string; message: string }> = [];
    for (const c of form.process.criteria) if (c.required && !(answers[c.code] ?? '').trim()) errs.push({ id: `q-${c.code}`, message: `${c.code}: ${labels['form.missing']}` });
    for (const k of form.process.knockouts) if (!['yes', 'no'].includes((answers[k.code] ?? '').toLowerCase())) errs.push({ id: `k-${k.code}-yes`, message: `${k.code}: ${labels['form.missing']}` });
    for (const c of form.process.criteria) if ((answers[c.code] ?? '').length > LIMIT) errs.push({ id: `q-${c.code}`, message: `${c.code}: ${LIMIT}` });
    if (!consent) errs.push({ id: 'consent', message: `${labels['form.consent'].slice(0, 40)}…: ${labels['form.missing']}` });
    setErrors(errs);
    if (errs.length) return;
    try {
      const r = await candidateApi.command('submit-application', { applicationId: form.applicationId, answers, consent });
      setSubmitted({ version: r.version });
      setStatus(labels['confirm.title']);
      dirty.current = false;
    } catch (err) {
      const e = err as { error?: string; details?: { fields?: string[]; closeAt?: string } };
      if (e.error === 'answers_incomplete') setErrors((e.details?.fields ?? []).map(f => ({ id: f === 'consent' ? 'consent' : `q-${f}`, message: `${f}: ${labels['form.missing']}` })));
      else setStatus(errorMessage(err));
    }
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.append('applicationId', form.applicationId);
    fd.append('file', file);
    const res = await fetch('/api/commands/upload-document', { method: 'POST', body: fd, credentials: 'same-origin' });
    const body = await res.json();
    if (!res.ok) { setStatus(errorMessage(body)); return; }
    setDocuments(d => [...d, { documentId: body.documentId, filename: file.name, size: file.size, scanStatus: 'PendingScan' }]);
    setStatus(labels['form.saved']);
  }

  async function removeDoc(documentId: string) {
    try { await candidateApi.command('remove-document', { applicationId: form.applicationId, documentId }); setDocuments(d => d.filter(x => x.documentId !== documentId)); } catch (e) { setStatus(errorMessage(e)); }
  }

  const statusLabel = form.stageLabel ?? labels[`status.${form.status}` as MessageKey] ?? form.status;

  return (
    <>
      <h1 className="text-2xl font-bold mb-1">{labels['form.title']}: {form.process.title}</h1>
      <p className="mb-4 text-sm text-gray-700">{form.process.reference} · {labels['status.status']}: {statusLabel}{form.applicationVersion ? ` · v${form.applicationVersion}` : ''}</p>
      {submitted ? <Banner kind="success"><strong>{labels['confirm.title']}</strong> {confirmText}</Banner> : null}
      {!editable && form.status !== 'Draft' ? <Banner kind="info">{closedText}</Banner> : null}
      {form.interview || form.invitationSent ? <p className="mb-3"><a href={`/${locale}/me/interviews/${form.applicationId}`} className="btn-secondary">{labels['interview.title']}</a></p> : null}
      {form.offer ? <p className="mb-3"><a href={`/${locale}/me/offers/${form.applicationId}`} className="btn-primary">{labels['offer.title']}</a></p> : null}
      {form.exam ? <p className="mb-3"><a href={`/${locale}/me/exams/${form.applicationId}`} className="btn-secondary">{form.exam.criterionCode}: {locale === 'fr' ? 'Examen écrit' : 'Written exam'}</a></p> : null}

      <form onSubmit={submit} noValidate>
        <ErrorSummary title={labels['a11y.error_summary']} errors={errors} />
        <fieldset className="card mb-4" disabled={!editable}>
          <legend className="font-bold text-lg px-1">{labels['form.questions']}</legend>
          {form.process.knockouts.map(k => {
            const err = errors.find(x => x.id === `k-${k.code}-yes`);
            return (
              <fieldset key={k.code} className="mb-4" aria-describedby={err ? `k-${k.code}-error` : undefined}>
                <legend className="font-semibold">{k.code}. <span lang={k.question.lang !== locale ? k.question.lang : undefined}>{k.question.text}</span> <span className="text-sm font-normal">({labels['form.required']})</span></legend>
                <div className="flex gap-4 mt-1">
                  {(['yes', 'no'] as const).map(v => <label key={v} className="inline-flex items-center gap-2 min-h-[44px]"><input type="radio" id={`k-${k.code}-${v}`} name={`k-${k.code}`} className="h-6 w-6" checked={(answers[k.code] ?? '').toLowerCase() === v} onChange={() => set(k.code, v)} /> {labels[`form.${v}`]}</label>)}
                </div>
                {err ? <p id={`k-${k.code}-error`} className="field-error">{err.message}</p> : null}
              </fieldset>
            );
          })}
          {form.process.criteria.map(c => {
            const err = errors.find(x => x.id === `q-${c.code}`);
            const remaining = LIMIT - (answers[c.code] ?? '').length;
            return (
              <Field key={c.code} id={`q-${c.code}`} label={`${c.code}. ${c.text.text}`} required={c.required} help={`${c.required ? labels['form.required'] : labels['form.optional']}`} error={err?.message}>
                <textarea id={`q-${c.code}`} className="input" rows={5} value={answers[c.code] ?? ''} onChange={e => set(c.code, e.target.value)} aria-invalid={!!err || remaining < 0} aria-describedby={`q-${c.code}-help q-${c.code}-count${err ? ` q-${c.code}-error` : ''}`} lang={c.text.lang !== locale ? c.text.lang : undefined} />
                <p id={`q-${c.code}-count`} className={`help ${remaining < 0 ? 'field-error' : ''}`} aria-live={remaining <= 50 ? 'polite' : 'off'}>{remaining} {labels['form.remaining']}</p>
              </Field>
            );
          })}
        </fieldset>

        <fieldset className="card mb-4">
          <legend className="font-bold text-lg px-1">{labels['form.documents']}</legend>
          <ul className="list-none p-0 m-0 mb-2">
            {documents.map(d => <li key={d.documentId} className="flex items-center gap-3 py-1"><span>{d.filename} <span className="badge">{d.scanStatus}</span></span>{form.status === 'Draft' ? <button type="button" className="btn-secondary" onClick={() => removeDoc(d.documentId)}>{labels['form.remove']}</button> : null}</li>)}
          </ul>
          {editable ? <Field id="file" label={labels['form.upload']}><input id="file" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="input" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} /></Field> : null}
        </fieldset>

        {editable ? (
          <>
            <div className="mb-4 flex items-start gap-2">
              <input id="consent" type="checkbox" className="mt-1 h-6 w-6" checked={consent} onChange={e => setConsent(e.target.checked)} aria-invalid={!!errors.find(x => x.id === 'consent')} aria-describedby={errors.find(x => x.id === 'consent') ? 'consent-error' : undefined} />
              <label htmlFor="consent">{labels['form.consent']}</label>
            </div>
            {errors.find(x => x.id === 'consent') ? <p id="consent-error" className="field-error mb-2">{labels['form.missing']}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={saveDraft}>{labels['form.save']}</button>
              <button type="submit" className="btn-primary">{form.status === 'Draft' ? labels['form.submit'] : labels['form.resubmit']}</button>
            </div>
          </>
        ) : null}
      </form>

      {form.status !== 'Withdrawn' && form.status !== 'Hired' ? (
        <section aria-labelledby="ee" className="card mt-6">
          <h2 id="ee" className="text-lg font-bold mb-1">{labels['form.self_declaration']}</h2>
          <p className="help mb-3">{labels['form.self_declaration_help']}</p>
          {eeDone ? (
            <button type="button" className="btn-secondary" onClick={async () => { try { await candidateApi.command('withdraw-self-declaration', { applicationId: form.applicationId }); setEeDone(false); setStatus(labels['form.saved']); } catch (e) { setStatus(errorMessage(e)); } }}>{labels['form.self_declaration_withdraw']}</button>
          ) : (
            <fieldset>
              <legend className="sr-only">{labels['form.self_declaration']}</legend>
              {EE_GROUPS.map(([id, en, fr]) => <label key={id} className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="h-6 w-6" checked={eeGroups.includes(id)} onChange={e => setEeGroups(g => e.target.checked ? [...g, id] : g.filter(x => x !== id))} /> {locale === 'fr' ? fr : en}</label>)}
              <div className="flex gap-2 mt-2">
                <button type="button" className="btn-primary" onClick={async () => { try { await candidateApi.command('record-self-declaration', { applicationId: form.applicationId, groups: eeGroups }); setEeDone(true); setStatus(labels['form.saved']); } catch (e) { setStatus(errorMessage(e)); } }}>{labels['form.self_declaration_save']}</button>
                <a href="#accommodation" className="btn-secondary">{labels['form.self_declaration_skip']}</a>
              </div>
            </fieldset>
          )}
        </section>
      ) : null}

      <section aria-labelledby="accommodation" className="card mt-6">
        <h2 id="accommodation" className="text-lg font-bold mb-1">{labels['form.accommodation']}</h2>
        <p className="help mb-3">{labels['form.accommodation_help']}</p>
        <Field id="acc-text" label={labels['form.accommodation']}><textarea id="acc-text" className="input" rows={3} value={accText} onChange={e => setAccText(e.target.value)} /></Field>
        <button type="button" className="btn-secondary" onClick={async () => { try { await candidateApi.command('request-accommodation', { applicationId: form.applicationId, text: accText, contactPreference: 'email' }); setAccText(''); setStatus(labels['form.saved']); } catch (e) { setStatus(errorMessage(e)); } }}>{labels['form.accommodation_send']}</button>
      </section>

      {!editable && ['Submitted', 'Active'].includes(form.status) ? (
        <section aria-labelledby="note" className="card mt-6">
          <h2 id="note" className="text-lg font-bold mb-1">{locale === 'fr' ? 'Note pour les RH' : 'Note for HR'}</h2>
          <Field id="note-text" label={locale === 'fr' ? 'Votre note' : 'Your note'}><textarea id="note-text" className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} /></Field>
          <button type="button" className="btn-secondary" onClick={async () => { try { await candidateApi.command('add-candidate-note', { applicationId: form.applicationId, text: note }); setNote(''); setStatus(labels['form.saved']); } catch (e) { setStatus(errorMessage(e)); } }}>{labels['form.save']}</button>
        </section>
      ) : null}

      {['Draft', 'Submitted', 'Active'].includes(form.status) ? (
        <section aria-labelledby="withdraw" className="card mt-6">
          <h2 id="withdraw" className="text-lg font-bold mb-2">{labels['form.withdraw']}</h2>
          <WithdrawForm applicationId={form.applicationId} labels={labels} onDone={() => location.reload()} />
        </section>
      ) : null}

      <section aria-labelledby="history" className="mt-6">
        <h2 id="history" className="text-lg font-bold mb-2">{labels['status.history']}</h2>
        <ul className="list-disc pl-5">
          {form.notifications.map((n: { template_key: string; lang: string; status: string; queued_at: string }, i: number) => <li key={i}>{n.template_key} ({n.lang}) — {n.status} — <time dateTime={n.queued_at}>{new Date(n.queued_at).toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA')}</time></li>)}
        </ul>
      </section>
      <LiveStatus message={status} />
    </>
  );
}

function WithdrawForm({ applicationId, labels, onDone }: { applicationId: string; labels: Record<MessageKey, string>; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('');
  return (
    <form onSubmit={async e => { e.preventDefault(); try { await candidateApi.command('withdraw-application', { applicationId, reason: reason || undefined }); onDone(); } catch (err) { setStatus(errorMessage(err)); } }}>
      <Field id="withdraw-reason" label={labels['form.withdraw_reason']}><input id="withdraw-reason" className="input" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <button type="submit" className="btn-danger">{labels['form.withdraw']}</button>
      <LiveStatus message={status} />
    </form>
  );
}
