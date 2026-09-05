'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell, langMapInput, Status } from '@/components/staff/Shell';
import { staffApi, errorMessage } from '@/lib/ui/client-api';
import { Field } from '@/components/ui';

export default function NewProcess() {
  return <Shell title="New hiring process">{me => <Form me={me} />}</Shell>;
}

function Form({ me }: { me: import('@/components/staff/Shell').Me }) {
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
      {langMapInput(title, setTitle, 'title', 'Title', me.org.languages)}
      <Field id="hm" label="Hiring manager"><select id="hm" className="input" value={hm} onChange={e => setHm(e.target.value)}>{active.map(u => <option key={u.userId} value={u.userId}>{u.displayName}</option>)}</select></Field>
      <Field id="hr" label="HR advisor"><select id="hr" className="input" value={hr} onChange={e => setHr(e.target.value)}>{active.map(u => <option key={u.userId} value={u.userId}>{u.displayName}</option>)}</select></Field>
      <Field id="location" label="Location"><input id="location" className="input" value={location} onChange={e => setLocation(e.target.value)} /></Field>
      <button type="submit" className="btn-primary">Create draft</button>
      <Status message={status} />
    </form>
  );
}
