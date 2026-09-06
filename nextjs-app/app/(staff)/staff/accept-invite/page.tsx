'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { ErrorSummary, Field } from '@/components/ui';
import { Attribution } from '@/components/Attribution';
import { useStaffI18n, LanguageToggle, I18n } from '@/components/staff/Shell';

function InviteForm({ i18n }: { i18n: I18n }) {
  const { t } = i18n;
  const router = useRouter();
  const sp = useSearchParams();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Array<{ id: string; message: string }>>([]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 12) { setErrors([{ id: 'password', message: t('invite.password_short') }]); return; }
    try { await staffApi.command('accept-invite', { token: sp.get('token') ?? '', password, displayName }); router.replace('/staff/login'); }
    catch (err) { setErrors([{ id: 'password', message: errorMessage(err) }]); }
  }
  return (
    <form onSubmit={submit} noValidate className="max-w-sm">
      <ErrorSummary title={t('problem')} errors={errors} />
      <Field id="name" label={t('invite.name')}><input id="name" className="input" autoComplete="name" value={displayName} onChange={e => setDisplayName(e.target.value)} /></Field>
      <Field id="password" label={t('invite.password')} help={t('invite.password_help')} required error={errors[0]?.message}><input id="password" type="password" autoComplete="new-password" className="input" value={password} onChange={e => setPassword(e.target.value)} /></Field>
      <button type="submit" className="btn-primary">{t('invite.submit')}</button>
    </form>
  );
}

export default function AcceptInvite() {
  const i18n = useStaffI18n();
  return (
    <>
      <a href="#main" className="skip-link">{i18n.t('skip')}</a>
      <main id="main" className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex justify-between items-start"><h1 className="text-2xl font-bold mb-4">{i18n.t('invite.title')}</h1><LanguageToggle i18n={i18n} /></div>
        <Suspense fallback={null}><InviteForm i18n={i18n} /></Suspense>
      </main>
      <footer className="max-w-7xl mx-auto px-4 py-6"><Attribution lang={i18n.lang} /></footer>
    </>
  );
}
