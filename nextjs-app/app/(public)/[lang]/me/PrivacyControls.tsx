'use client';

import { useState } from 'react';
import { candidateApi, errorMessage } from '@/lib/ui/client-api';
import { Field, LiveStatus, Banner } from '@/components/ui';

export function PrivacyControls({ locale, profile, labels }: { locale: 'en' | 'fr'; profile: { name: string; phone: string; email: string; marketingOptOut: boolean; deletionDeferredUntil: string | null }; labels: Record<string, string> }) {
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [lang, setLang] = useState(locale);
  const [optOut, setOptOut] = useState(profile.marketingOptOut);
  const [status, setStatus] = useState('');
  const [info, setInfo] = useState('');
  const run = async (fn: () => Promise<unknown>, done: string) => { try { await fn(); setStatus(done); } catch (e) { setStatus(errorMessage(e)); } };
  return (
    <div className="grid gap-4 max-w-md">
      <form onSubmit={e => { e.preventDefault(); run(() => candidateApi.command('update-profile', { name, phone }), labels.saved); }}>
        <Field id="name" label={labels.name}><input id="name" className="input" autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field id="phone" label={labels.phone}><input id="phone" className="input" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} /></Field>
        <Field id="email" label={labels.email}><input id="email" className="input" type="email" value={profile.email} readOnly aria-readonly="true" /></Field>
        <button className="btn-secondary" type="submit">{labels.save}</button>
      </form>
      <Field id="lang" label={labels.language}>
        <select id="lang" className="input" value={lang} onChange={e => { const l = e.target.value as 'en' | 'fr'; setLang(l); run(() => candidateApi.command('change-locale', { locale: l }), labels.saved); }}>
          <option value="en">English</option><option value="fr">Français</option>
        </select>
      </Field>
      <div className="flex items-start gap-2">
        <input id="optout" type="checkbox" className="mt-1 h-6 w-6" checked={optOut} onChange={e => { setOptOut(e.target.checked); run(() => candidateApi.command('set-marketing-opt-out', { value: e.target.checked }), labels.saved); }} />
        <label htmlFor="optout">{labels.marketing}</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" type="button" onClick={() => run(async () => { await candidateApi.command('request-data-export', {}); setInfo(locale === 'fr' ? 'Un lien de téléchargement vous a été envoyé (valide 72 h).' : 'A download link has been emailed to you (valid 72 hours).'); }, labels.saved)}>{labels.export}</button>
        <button className="btn-danger" type="button" onClick={() => run(async () => { const r = await candidateApi.command('request-deletion', {}); setInfo(r.shredded ? (locale === 'fr' ? 'Vos données ont été supprimées.' : 'Your data has been deleted.') : (locale === 'fr' ? `Vos données seront supprimées le ${new Date(r.deferredUntil).toLocaleDateString('fr-CA')}. Vous pouvez plutôt retirer votre candidature.` : `Your data will be deleted on ${new Date(r.deferredUntil).toLocaleDateString('en-CA')}. You may withdraw your application instead.`)); }, labels.saved)}>{labels.del}</button>
      </div>
      {profile.deletionDeferredUntil ? <Banner kind="info">{locale === 'fr' ? `Suppression prévue le ${new Date(profile.deletionDeferredUntil).toLocaleDateString('fr-CA')}` : `Deletion scheduled for ${new Date(profile.deletionDeferredUntil).toLocaleDateString('en-CA')}`}</Banner> : null}
      {info ? <Banner kind="info">{info}</Banner> : null}
      <LiveStatus message={status} />
    </div>
  );
}
