'use client';

import { useState } from 'react';
import { candidateApi, errorMessage } from '@/lib/ui/client-api';
import { ErrorSummary, Field, LiveStatus } from '@/components/ui';

export function OfferActions({ applicationId, offerId, labels }: { applicationId: string; offerId: string; labels: Record<string, string> }) {
  const [typedName, setTypedName] = useState('');
  const [errors, setErrors] = useState<Array<{ id: string; message: string }>>([]);
  const [status, setStatus] = useState('');
  async function accept(e: React.FormEvent) {
    e.preventDefault();
    if (!typedName.trim()) { setErrors([{ id: 'typed-name', message: `${labels.typedName}: ${labels.missing}` }]); return; }
    try { await candidateApi.command('accept-offer', { applicationId, offerId, typedName }); location.reload(); } catch (err) { setStatus(errorMessage(err)); }
  }
  async function decline() {
    try { await candidateApi.command('decline-offer', { applicationId, offerId }); location.reload(); } catch (err) { setStatus(errorMessage(err)); }
  }
  return (
    <form onSubmit={accept} noValidate className="max-w-md">
      <ErrorSummary title={labels.errors} errors={errors} />
      <Field id="typed-name" label={labels.typedName} required error={errors[0]?.message}><input id="typed-name" className="input" autoComplete="name" value={typedName} onChange={e => setTypedName(e.target.value)} /></Field>
      <div className="flex gap-2"><button type="submit" className="btn-primary">{labels.accept}</button><button type="button" className="btn-secondary" onClick={decline}>{labels.decline}</button></div>
      <LiveStatus message={status} />
    </form>
  );
}
