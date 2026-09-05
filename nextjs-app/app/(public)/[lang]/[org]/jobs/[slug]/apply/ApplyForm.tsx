'use client';

import { useState } from 'react';
import { candidateApi } from '@/lib/ui/client-api';
import { ErrorSummary, Field, LiveStatus, Banner } from '@/components/ui';

export function ApplyForm({ org, locale, next, labels, privacyHref }: { org: string; locale: 'en' | 'fr'; next: string; labels: Record<string, string>; privacyHref: string }) {
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot (F07)
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<Array<{ id: string; message: string }>>([]);
  const [status, setStatus] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setErrors([{ id: 'email', message: `${labels.email}: ${labels.missing}` }]); return; }
    setErrors([]);
    await candidateApi.command('request-magic-link', { org, email, locale, next, website });
    setSent(true);
    setStatus(labels.sent);
  }
  if (sent) return <Banner kind="success">{labels.sent}</Banner>;
  return (
    <form onSubmit={submit} noValidate className="max-w-md">
      <ErrorSummary title={labels.errors} errors={errors} />
      <Field id="email" label={labels.email} help={labels.help} required error={errors.find(x => x.id === 'email')?.message}>
        <input id="email" name="email" type="email" autoComplete="email" className="input" value={email} onChange={e => setEmail(e.target.value)} aria-describedby="email-help" aria-invalid={errors.length > 0} required />
      </Field>
      <div className="hidden" aria-hidden="true"><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></div>
      <p className="help mb-4"><a href={privacyHref}>{labels.privacy}</a></p>
      <button type="submit" className="btn-primary">{labels.submit}</button>
      <LiveStatus message={status} />
    </form>
  );
}
