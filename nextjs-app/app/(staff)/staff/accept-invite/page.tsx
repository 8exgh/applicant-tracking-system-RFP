'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { ErrorSummary, Field } from '@/components/ui';

function InviteForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Array<{ id: string; message: string }>>([]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 12) { setErrors([{ id: 'password', message: 'Use at least 12 characters' }]); return; }
    try { await staffApi.command('accept-invite', { token: sp.get('token') ?? '', password, displayName }); router.replace('/staff/login'); }
    catch (err) { setErrors([{ id: 'password', message: errorMessage(err) }]); }
  }
  return (
    <form onSubmit={submit} noValidate className="max-w-sm">
      <ErrorSummary title="There is a problem" errors={errors} />
      <Field id="name" label="Your name"><input id="name" className="input" autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} /></Field>
      <Field id="password" label="Choose a password" help="At least 12 characters. Common or breached passwords are rejected." required error={errors[0]?.message}><input id="password" type="password" autoComplete="new-password" className="input" value={password} onChange={e => setPassword(e.target.value)} /></Field>
      <button type="submit" className="btn-primary">Activate account</button>
    </form>
  );
}

export default function AcceptInvite() {
  return (
    <main id="main" className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-4">Accept your invitation</h1>
      <Suspense fallback={null}><InviteForm /></Suspense>
    </main>
  );
}
