'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell, langMapInput, Status, useI18n, Me } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { Field } from '@/components/ui';

export default function NewProcess() {
  return <Shell title="new.title">{me => <Form me={me} />}</Shell>;
}

function Form({ me }: { me: Me }) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState<Record<string, string>>({});
  const [hm, setHm] = useState(me.users.find(u => u.roles.includes('hiring_manager'))?.userId ?? me.userId);
  const [hr, setHr] = useState(me.users.find(u => u.roles.includes('hr_advisor'))?.userId ?? me.userId);
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { const r = await staffApi.command('create-process', { title, hiringManager: hm, hrAdvisor: hr, location }); router.push(`/staff/processes/${r.processId}`); } catch (err) { setStatus(errorMessage(err)); }
  }
  const active = me.users.filter(u => u.status === 'Active');
  return (
    <form onSubmit={submit} className="max-w-xl">
      {langMapInput(title, setTitle, 'title', t('new.name'), me.org.languages)}
      <Field id="hm" label={t('new.hm')}><select id="hm" className="input" value={hm} onChange={e => setHm(e.target.value)}>{active.map(u => <option key={u.userId} value={u.userId}>{u.displayName}</option>)}</select></Field>
      <Field id="hr" label={t('new.hr')}><select id="hr" className="input" value={hr} onChange={e => setHr(e.target.value)}>{active.map(u => <option key={u.userId} value={u.userId}>{u.displayName}</option>)}</select></Field>
      <Field id="location" label={t('new.location')}><input id="location" className="input" value={location} onChange={e => setLocation(e.target.value)} /></Field>
      <button type="submit" className="btn-primary">{t('new.create')}</button>
      <Status message={status} />
    </form>
  );
}
