'use client';

import { useState } from 'react';
import { Shell, useQuery, Status, Me, useI18n } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { Field } from '@/components/ui';

type Settings = Awaited<ReturnType<typeof import('@/lib/queries/staff').orgSettingsView>>;

export default function SettingsPage() {
  return <Shell title="settings.title">{me => <View me={me} />}</Shell>;
}

function View({ me }: { me: Me }) {
  const { t, label } = useI18n();
  const { data: s, error, reload } = useQuery<Settings>('organization-settings', {});
  const [status, setStatus] = useState('');
  const admin = me.roles.includes('org_admin');
  const run = async (name: string, body: Record<string, unknown>, done: string) => { try { const r = await staffApi.command(name, body); setStatus(done + (r?.inviteLink ? ` — ${t('settings.invite_link')} : ${r.inviteLink}` : '')); reload(); } catch (e) { setStatus(errorMessage(e)); } };
  if (error) return <p role="alert" className="field-error">{error}</p>;
  if (!s) return <p role="status">{t('loading')}</p>;
  return (
    <>
      <Status message={status} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-labelledby="org"><h2 id="org" className="font-bold mb-2">{t('settings.org')}</h2>
          <p>{s.name} · {t('settings.slug')} {s.slug} · {s.timeZone} · {t('settings.languages')} {s.languages.map(l => `${l.code} (${l.required ? t('settings.required') : t('settings.optional')})`).join(', ')}</p>
          <p className="text-sm">{t('settings.line', { threshold: s.settings.suppressionThreshold, notice: s.settings.privacyNoticeVersion, approval: s.settings.offerApprovalRequired ? t('settings.approval_required') : t('settings.approval_not_required'), hours: s.settings.rescheduleCutoffHours })}</p>
          {admin ? <OrgForm s={s} onSave={b => run('update-organization-settings', b, t('settings.saved'))} /> : null}
          {admin ? <BrandingForm b={s.branding as unknown as Record<string, string | undefined>} onSave={b => run('update-branding', b, t('settings.branding_saved'))} /> : null}
          <p className="text-sm mt-2">{t('settings.flags')} : {Object.entries(s.featureFlags).map(([k, v]) => `${k}=${v}`).join(', ') || t('none')}</p>
        </section>
        <section className="card" aria-labelledby="users"><h2 id="users" className="font-bold mb-2">{t('settings.users')}</h2>
          <table className="table"><caption className="sr-only">{t('settings.users')}</caption><thead><tr><th scope="col">{t('settings.name')}</th><th scope="col">{t('settings.email')}</th><th scope="col">{t('settings.roles')}</th><th scope="col">{t('settings.status')}</th>{admin ? <th scope="col">{t('settings.actions')}</th> : null}</tr></thead><tbody>
            {s.users.map(u => <tr key={u.userId}><td>{u.displayName}</td><td>{u.email}</td><td>{u.roles.map(r => label('role', r)).join(', ')}</td><td>{label('us', u.status)}</td>{admin ? <td>{u.status !== 'Deactivated' && u.userId !== me.userId ? <button className="btn-secondary !min-h-[32px] !py-0 text-xs" onClick={() => run('deactivate-user', { userId: u.userId }, t('settings.deactivated'))}>{t('settings.deactivate')}</button> : null}</td> : null}</tr>)}
          </tbody></table>
          {admin ? <InviteForm onInvite={b => run('invite-user', b, t('settings.invited'))} /> : null}
          {admin ? <button className="btn-danger mt-3" onClick={() => run('revoke-all-sessions', {}, t('settings.revoked'))}>{t('settings.revoke')}</button> : null}
        </section>
        <section className="card lg:col-span-2" aria-labelledby="tpl"><h2 id="tpl" className="font-bold mb-2">{t('settings.templates')}</h2>
          <p className="help mb-2">{t('settings.templates_help')}</p>
          {admin ? <TemplateForm onSave={b => run('save-template', b, t('settings.template_saved'))} /> : null}
          <table className="table mt-3"><caption className="sr-only">{t('settings.saved_templates')}</caption><thead><tr><th scope="col">{t('settings.key')}</th><th scope="col">{t('settings.lang')}</th><th scope="col">{t('settings.version')}</th><th scope="col">{t('settings.subject')}</th></tr></thead><tbody>{s.templates.map((x: { key: string; lang: string; version: number; subject: string }) => <tr key={`${x.key}-${x.lang}`}><td>{x.key}</td><td>{x.lang}</td><td>{x.version}</td><td>{x.subject}</td></tr>)}</tbody></table>
        </section>
        <section className="card lg:col-span-2" aria-labelledby="exp"><h2 id="exp" className="font-bold mb-2">{t('settings.exports')}</h2>
          <p><a href="/api/queries/tenant-export">{t('settings.tenant_export')}</a> · <a href="/api/queries/notification-log">{t('settings.notification_log')}</a>{admin ? <> · <a href="/api/queries/security-log">{t('settings.security_log')}</a> · <a href="/api/queries/access-log">{t('settings.access_log')}</a></> : null}</p>
        </section>
      </div>
    </>
  );
}

function OrgForm({ s, onSave }: { s: Settings; onSave: (b: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const [fr, setFr] = useState(s.languages.find(l => l.code === 'fr')?.required ? 'required' : s.languages.some(l => l.code === 'fr') ? 'optional' : 'off');
  const [tz, setTz] = useState(s.timeZone);
  const [thr, setThr] = useState(s.settings.suppressionThreshold);
  const [approval, setApproval] = useState(s.settings.offerApprovalRequired);
  return <div className="grid sm:grid-cols-2 gap-2 mt-3"><Field id="fr" label={t('settings.french')}><select id="fr" className="input" value={fr} onChange={e => setFr(e.target.value)}><option value="required">{t('settings.required')}</option><option value="optional">{t('settings.optional')}</option><option value="off">{t('settings.not_offered')}</option></select></Field><Field id="tz" label={t('settings.timezone')}><input id="tz" className="input" value={tz} onChange={e => setTz(e.target.value)} /></Field><Field id="thr" label={t('settings.threshold')}><input id="thr" type="number" className="input" value={thr} onChange={e => setThr(+e.target.value)} /></Field><label className="inline-flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="h-5 w-5" checked={approval} onChange={e => setApproval(e.target.checked)} /> {t('settings.offer_approval')}</label><button className="btn-secondary" onClick={() => onSave({ languages: [{ code: 'en', required: true }, ...(fr === 'off' ? [] : [{ code: 'fr', required: fr === 'required' }])], timeZone: tz, settings: { suppressionThreshold: thr, offerApprovalRequired: approval } })}>{t('settings.save')}</button></div>;
}

function BrandingForm({ b, onSave }: { b: Record<string, string | undefined>; onSave: (b: Record<string, string>) => void }) {
  const { t } = useI18n();
  const [primary, setPrimary] = useState(b.primary ?? '#1A4480');
  const [surface, setSurface] = useState(b.surface ?? '#FFFFFF');
  return <div className="flex flex-wrap gap-2 items-end mt-3"><Field id="primary" label={t('settings.primary')} help={t('settings.primary_help')}><input id="primary" className="input" value={primary} onChange={e => setPrimary(e.target.value)} /></Field><Field id="surface" label={t('settings.surface')}><input id="surface" className="input" value={surface} onChange={e => setSurface(e.target.value)} /></Field><button className="btn-secondary mb-4" onClick={() => onSave({ primary, surface })}>{t('settings.save_branding')}</button></div>;
}

function InviteForm({ onInvite }: { onInvite: (b: Record<string, unknown>) => void }) {
  const { t, label } = useI18n();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<string[]>(['hr_advisor']);
  const [language, setLanguage] = useState('en');
  return <div className="mt-3 grid sm:grid-cols-2 gap-2"><Field id="i-email" label={t('settings.email')}><input id="i-email" type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} /></Field><Field id="i-name" label={t('settings.name')}><input id="i-name" className="input" value={name} onChange={e => setName(e.target.value)} /></Field><fieldset className="sm:col-span-2"><legend className="label">{t('settings.roles')}</legend>{['org_admin', 'hr_advisor', 'hiring_manager', 'assessor', 'auditor'].map(r => <label key={r} className="inline-flex items-center gap-2 mr-4 min-h-[44px]"><input type="checkbox" className="h-5 w-5" checked={roles.includes(r)} onChange={e => setRoles(x => e.target.checked ? [...x, r] : x.filter(y => y !== r))} /> {label('role', r)}</label>)}</fieldset><Field id="i-lang" label={t('settings.language')}><select id="i-lang" className="input" value={language} onChange={e => setLanguage(e.target.value)}><option value="en">English</option><option value="fr">Français</option></select></Field><button className="btn-primary self-end mb-4" onClick={() => onInvite({ email, displayName: name, roles, language })}>{t('settings.invite')}</button></div>;
}

function TemplateForm({ onSave }: { onSave: (b: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const [key, setKey] = useState('application_submitted');
  const [lang, setLang] = useState('en');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  return <div className="grid sm:grid-cols-2 gap-2"><Field id="t-key" label={t('settings.template_key')}><input id="t-key" className="input" value={key} onChange={e => setKey(e.target.value)} /></Field><Field id="t-lang" label={t('settings.language')}><select id="t-lang" className="input" value={lang} onChange={e => setLang(e.target.value)}><option value="en">en</option><option value="fr">fr</option></select></Field><div className="sm:col-span-2"><Field id="t-subject" label={t('settings.subject')}><input id="t-subject" className="input" value={subject} onChange={e => setSubject(e.target.value)} /></Field><Field id="t-body" label={t('settings.body')}><textarea id="t-body" className="input" rows={5} value={body} onChange={e => setBody(e.target.value)} /></Field><button className="btn-secondary" onClick={() => onSave({ key, lang, subject, body })}>{t('settings.save_template')}</button></div></div>;
}
