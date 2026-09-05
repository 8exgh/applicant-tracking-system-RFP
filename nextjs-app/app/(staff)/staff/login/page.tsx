'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { staffApi, setStaffToken, errorMessage } from '@/lib/ui/client-api';
import { ErrorSummary, Field } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Array<{ id: string; message: string }>>([]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = [];
    if (!email) errs.push({ id: 'email', message: 'Email is required' });
    if (!password) errs.push({ id: 'password', message: 'Password is required' });
    setErrors(errs);
    if (errs.length) return;
    try {
      const r = await staffApi.command('staff-login', { email, password });
      setStaffToken(r.token);
      router.replace(sp.get('next') || '/staff');
    } catch (err) {
      const e = err as { error?: string };
      setErrors([{ id: 'email', message: e.error === 'rate_limited' ? 'Too many attempts. Try again in 15 minutes.' : 'Incorrect email or password.' }]);
    }
  }
  return (
    <form onSubmit={submit} noValidate className="max-w-sm">
      <ErrorSummary title="There is a problem" errors={errors} />
      <Field id="email" label="Email" required error={errors.find(x => x.id === 'email')?.message}><input id="email" type="email" autoComplete="username" className="input" value={email} onChange={e => setEmail(e.target.value)} /></Field>
      <Field id="password" label="Password" required error={errors.find(x => x.id === 'password')?.message}><input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={e => setPassword(e.target.value)} /></Field>
      <button type="submit" className="btn-primary">Sign in</button>
      <p className="mt-4 text-sm"><a href="/platform">Platform operator</a></p>
    </form>
  );
}

export default function Login() {
  return (
    <>
      <a href="#main" className="skip-link">Skip to main content</a>
      <main id="main" className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Staff sign-in</h1>
        <Suspense fallback={null}><LoginForm /></Suspense>
      </main>
    </>
  );
}
