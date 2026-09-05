'use client';

import { useState } from 'react';
import { Shell, useQuery, Status, Me } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { Field } from '@/components/ui';

type Settings = Awaited<ReturnType<typeof import('@/lib/queries/staff').orgSettingsView>>;

export default function SettingsPage() {
  return <Shell title="Organization settings">{me => <View me={me} />}</Shell>;
}

function View({ me }: { me: Me }) {
  const { data: s, error, reload } = useQuery<Settings>('organization-settings', {});
  const [status, setStatus] = useState('');
  const admin = me.roles.includes('org_admin');
  const run = async (name: string, body: Record<string, unknown>, done: string) => { try { const r = await staffApi.command(name, body); setStatus(done + (r?.inviteLink ? ` — invitation link: ${r.inviteLink}` : '')); reload(); } catch (e) { setStatus(errorMessage(e)); } };
  if (error) return <p role="alert" className="field-error">{error}</p>;
  if (!s) return <p role="status">Loading…</p>;
  return (
    <>
      <Status message={status} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-labelledby="org"><h2 id="org" className="font-bold mb-2">Organization</h2>
          <p>{s.name} · slug {s.slug} · {s.timeZone} · languages {s.languages.map(l => `${l.code}${l.required ? ' (required)' : ' (optional)'}`).join(', ')}</p>
          <p className="text-sm">Suppression threshold {s.settings.suppressionThreshold} · privacy notice v{s.settings.privacyNoticeVersion} · offer approval {s.settings.offerApprovalRequired ? 'required' : 'not required'} · reschedule cut-off {s.settings.rescheduleCutoffHours} h</p>
          {admin ? <OrgForm s={s} onSave={b => run('update-organization-settings', b, 'Settings saved')} /> : null}
          {admin ? <BrandingForm b={s.branding as unknown as Record<string, string | undefined>} onSave={b => run('update-branding', b, 'Branding saved')} /> : null}
          <p className="text-sm mt-2">Feature flags: {Object.entries(s.featureFlags).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}</p>
        </section>
        <section className="card" aria-labelledby="users"><h2 id="users" className="font-bold mb-2">Users</h2>
          <table className="table"><caption className="sr-only">Users</caption><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Roles</th><th scope="col">Status</th>{admin ? <th scope="col">Actions</th> : null}</tr></thead><tbody>
            {s.users.map(u => <tr key={u.userId}><td>{u.displayName}</td><td>{u.email}</td><td>{u.roles.join(', ')}</td><td>{u.status}</td>{admin ? <td>{u.status !== 'Deactivated' && u.userId !== me.userId ? <button className="btn-secondary !min-h-[32px] !py-0 text-xs" onClick={() => run('deactivate-user', { userId: u.userId }, 'User deactivated')}>Deactivate</button> : null}</td> : null}</tr>)}
          </tbody></table>
          {admin ? <InviteForm onInvite={b => run('invite-user', b, 'Invitation sent')} /> : null}
          {admin ? <button className="btn-danger mt-3" onClick={() => run('revoke-all-sessions', {}, 'All sessions revoked')}>Revoke all sessions</button> : null}
        </section>
        <section className="card lg:col-span-2" aria-labelledby="tpl"><h2 id="tpl" className="font-bold mb-2">Notification templates</h2>
          <p className="help mb-2">Placeholders: candidate_name, process_title, reference, closing_time, organization_name, stage_label, interview_time, offer_expiry, link, reason, position, start_date, salary. Built-in bilingual defaults apply until you save your own.</p>
          {admin ? <TemplateForm onSave={b => run('save-template', b, 'Template saved')} /> : null}
          <table className="table mt-3"><caption className="sr-only">Saved templates</caption><thead><tr><th scope="col">Key</th><th scope="col">Lang</th><th scope="col">Version</th><th scope="col">Subject</th></tr></thead><tbody>{s.templates.map((t: { key: string; lang: string; version: number; subject: string }) => <tr key={`${t.key}-${t.lang}`}><td>{t.key}</td><td>{t.lang}</td><td>{t.version}</td><td>{t.subject}</td></tr>)}</tbody></table>
        </section>
        <section className="card lg:col-span-2" aria-labelledby="exp"><h2 id="exp" className="font-bold mb-2">Exports and logs</h2>
          <p><a href="/api/queries/tenant-export">Full tenant export (JSON)</a> · <a href="/api/queries/notification-log">Notification log</a>{admin ? <> · <a href="/api/queries/security-log">Security log</a> · <a href="/api/queries/access-log">Access log</a></> : null}</p>
        </section>
      </div>
    </>
  );
}

function OrgForm({ s, onSave }: { s: Settings; onSave: (b: Record<string, unknown>) => void }) {
  const [fr, setFr] = useState(s.languages.find(l => l.code === 'fr')?.required ? 'required' : s.languages.some(l => l.code === 'fr') ? 'optional' : 'off');
  const [tz, setTz] = useState(s.timeZone);
  const [thr, setThr] = useState(s.settings.suppressionThreshold);
  const [approval, setApproval] = useState(s.settings.offerApprovalRequired);
  return <div className="grid sm:grid-cols-2 gap-2 mt-3"><Field id="fr" label="French"><select id="fr" className="input" value={fr} onChange={e => setFr(e.target.value)}><option value="required">required</option><option value="optional">optional</option><option value="off">not offered</option></select></Field><Field id="tz" label="Time zone"><input id="tz" className="input" value={tz} onChange={e => setTz(e.target.value)} /></Field><Field id="thr" label="Suppression threshold"><input id="thr" type="number" className="input" value={thr} onChange={e => setThr(+e.target.value)} /></Field><label className="inline-flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="h-5 w-5" checked={approval} onChange={e => setApproval(e.target.checked)} /> Offers require admin approval</label><button className="btn-secondary" onClick={() => onSave({ languages: [{ code: 'en', required: true }, ...(fr === 'off' ? [] : [{ code: 'fr', required: fr === 'required' }])], timeZone: tz, settings: { suppressionThreshold: thr, offerApprovalRequired: approval } })}>Save settings</button></div>;
}

function BrandingForm({ b, onSave }: { b: Record<string, string | undefined>; onSave: (b: Record<string, string>) => void }) {
  const [primary, setPrimary] = useState(b.primary ?? '#1A4480');
  const [surface, setSurface] = useState(b.surface ?? '#FFFFFF');
  return <div className="flex flex-wrap gap-2 items-end mt-3"><Field id="primary" label="Primary colour" help="Contrast against the surface must be at least 4.5:1"><input id="primary" className="input" value={primary} onChange={e => setPrimary(e.target.value)} /></Field><Field id="surface" label="Surface colour"><input id="surface" className="input" value={surface} onChange={e => setSurface(e.target.value)} /></Field><button className="btn-secondary mb-4" onClick={() => onSave({ primary, surface })}>Save branding</button></div>;
}

function InviteForm({ onInvite }: { onInvite: (b: Record<string, unknown>) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<string[]>(['hr_advisor']);
  const [language, setLanguage] = useState('en');
  return <div className="mt-3 grid sm:grid-cols-2 gap-2"><Field id="i-email" label="Email"><input id="i-email" type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} /></Field><Field id="i-name" label="Name"><input id="i-name" className="input" value={name} onChange={e => setName(e.target.value)} /></Field><fieldset className="sm:col-span-2"><legend className="label">Roles</legend>{['org_admin', 'hr_advisor', 'hiring_manager', 'assessor', 'auditor'].map(r => <label key={r} className="inline-flex items-center gap-2 mr-4 min-h-[44px]"><input type="checkbox" className="h-5 w-5" checked={roles.includes(r)} onChange={e => setRoles(x => e.target.checked ? [...x, r] : x.filter(y => y !== r))} /> {r}</label>)}</fieldset><Field id="i-lang" label="Language"><select id="i-lang" className="input" value={language} onChange={e => setLanguage(e.target.value)}><option value="en">English</option><option value="fr">Français</option></select></Field><button className="btn-primary self-end mb-4" onClick={() => onInvite({ email, displayName: name, roles, language })}>Invite</button></div>;
}

function TemplateForm({ onSave }: { onSave: (b: Record<string, unknown>) => void }) {
  const [key, setKey] = useState('application_submitted');
  const [lang, setLang] = useState('en');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  return <div className="grid sm:grid-cols-2 gap-2"><Field id="t-key" label="Template key"><input id="t-key" className="input" value={key} onChange={e => setKey(e.target.value)} /></Field><Field id="t-lang" label="Language"><select id="t-lang" className="input" value={lang} onChange={e => setLang(e.target.value)}><option value="en">en</option><option value="fr">fr</option></select></Field><div className="sm:col-span-2"><Field id="t-subject" label="Subject"><input id="t-subject" className="input" value={subject} onChange={e => setSubject(e.target.value)} /></Field><Field id="t-body" label="Body"><textarea id="t-body" className="input" rows={5} value={body} onChange={e => setBody(e.target.value)} /></Field><button className="btn-secondary" onClick={() => onSave({ key, lang, subject, body })}>Save template</button></div></div>;
}
