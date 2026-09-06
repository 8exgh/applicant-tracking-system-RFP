'use client';

import { useEffect, useState } from 'react';
import { staffApi, setStaffToken, staffToken, errorMessage } from '@/lib/ui/client-api';
import { Field } from '@/components/ui';
import { Status, useStaffI18n, LanguageToggle } from '@/components/staff/Shell';

// Platform operator: create organizations, flags, health (F01, F28)
export default function Platform() {
  const i18n = useStaffI18n();
  const { t } = i18n;
  const [me, setMe] = useState<{ kind: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [orgs, setOrgs] = useState<Array<{ tenant_id: string; slug: string; name: string; feature_flags: Record<string, boolean> }>>([]);
  const [health, setHealth] = useState<unknown>(null);
  const [form, setForm] = useState({ name: '', slug: '', timeZone: 'America/Toronto', adminEmail: '', adminName: '', frRequired: true, referencePrefix: '' });
  const load = () => { staffApi.query('me').then(m => { setMe(m); if (m.kind === 'platform') { staffApi.query('organizations').then(setOrgs); staffApi.query('platform-health').then(setHealth); } }).catch(() => setMe(null)); };
  useEffect(() => { if (staffToken()) load(); }, []);
  const login = async (e: React.FormEvent) => { e.preventDefault(); try { const r = await staffApi.command('platform-login', { email, password }); setStaffToken(r.token); load(); } catch (err) { setStatus(errorMessage(err)); } };
  const create = async (e: React.FormEvent) => { e.preventDefault(); try { const r = await staffApi.command('create-organization', { name: form.name, slug: form.slug, timeZone: form.timeZone, adminEmail: form.adminEmail, adminName: form.adminName, referencePrefix: form.referencePrefix || undefined, languages: [{ code: 'en', required: true }, { code: 'fr', required: form.frRequired }] }); setStatus(t('platform.created', { slug: form.slug, link: r.inviteLink })); load(); } catch (err) { setStatus(errorMessage(err)); } };
  const flag = async (tenantId: string, name: string, enabled: boolean) => { try { await staffApi.command('set-feature-flag', { tenantId, flag: name, enabled }); setStatus(t('platform.flag_saved')); load(); } catch (err) { setStatus(errorMessage(err)); } };
  return (
    <>
      <a href="#main" className="skip-link">{t('skip')}</a>
      <main id="main" className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex justify-between items-start"><h1 className="text-2xl font-bold mb-4">{t('platform.title')}</h1><LanguageToggle i18n={i18n} /></div>
        <Status message={status} />
        {me?.kind !== 'platform' ? (
          <form onSubmit={login} className="max-w-sm"><Field id="email" label={t('login.email')}><input id="email" type="email" className="input" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></Field><Field id="password" label={t('login.password')}><input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></Field><button className="btn-primary" type="submit">{t('login.submit')}</button></form>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card" aria-labelledby="new"><h2 id="new" className="font-bold mb-2">{t('platform.create')}</h2>
              <form onSubmit={create}>
                <Field id="name" label={t('settings.name')}><input id="name" className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
                <Field id="slug" label={t('settings.slug')} help={t('platform.slug_help')}><input id="slug" className="input" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} /></Field>
                <Field id="tz" label={t('settings.timezone')}><input id="tz" className="input" value={form.timeZone} onChange={e => setForm({ ...form, timeZone: e.target.value })} /></Field>
                <Field id="prefix" label={t('platform.prefix')}><input id="prefix" className="input" value={form.referencePrefix} onChange={e => setForm({ ...form, referencePrefix: e.target.value })} /></Field>
                <Field id="admin" label={t('platform.admin_email')}><input id="admin" type="email" className="input" value={form.adminEmail} onChange={e => setForm({ ...form, adminEmail: e.target.value })} /></Field>
                <Field id="adminName" label={t('platform.admin_name')}><input id="adminName" className="input" value={form.adminName} onChange={e => setForm({ ...form, adminName: e.target.value })} /></Field>
                <label className="inline-flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="h-5 w-5" checked={form.frRequired} onChange={e => setForm({ ...form, frRequired: e.target.checked })} /> {t('platform.fr_required')}</label>
                <div><button className="btn-primary" type="submit">{t('platform.create_btn')}</button></div>
              </form>
            </section>
            <section className="card" aria-labelledby="orgs"><h2 id="orgs" className="font-bold mb-2">{t('platform.orgs')}</h2>
              <ul className="list-none p-0 m-0">{orgs.map(o => <li key={o.tenant_id} className="border-t py-2"><strong>{o.name}</strong> ({o.slug}) — <a href={`/${i18n.lang}/${o.slug}/jobs`}>{t('platform.careers')}</a><br /><label className="inline-flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="h-5 w-5" checked={!!o.feature_flags?.rolling_screening} onChange={e => flag(o.tenant_id, 'rolling_screening', e.target.checked)} /> rolling_screening</label></li>)}</ul>
            </section>
            <section className="card lg:col-span-2" aria-labelledby="health"><h2 id="health" className="font-bold mb-2">{t('platform.health')}</h2><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(health, null, 1)}</pre><a href="/api/health">/api/health</a></section>
          </div>
        )}
      </main>
    </>
  );
}
