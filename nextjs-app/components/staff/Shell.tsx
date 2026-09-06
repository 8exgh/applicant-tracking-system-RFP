'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { staffApi, setStaffToken, staffToken } from '@/lib/ui/client-api';
import { ts, StaffKey, label as labelOf, readStaffLang, writeStaffLang, fmt } from '@/lib/i18n/staff';
import { Locale } from '@/types/shared';
import { Attribution } from '@/components/Attribution';

export interface Me { kind: string; userId: string; tenantId: string; roles: string[]; displayName: string; language: string; email: string; org: { name: string; slug: string; timeZone: string; languages: Array<{ code: 'en' | 'fr'; required: boolean }>; settings: Record<string, unknown>; featureFlags: Record<string, boolean> }; users: Array<{ userId: string; displayName: string; roles: string[]; status: string }>; }

export interface I18n {
  lang: Locale;
  t: (key: StaffKey, values?: Record<string, string | number>) => string;
  label: (prefix: Parameters<typeof labelOf>[1], value: string) => string;
  fmt: (date: string | Date, timeZone: string) => string;
  setLang: (l: Locale) => void;
}

const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside a staff shell');
  return ctx;
}

// Language state shared by the shell and the standalone pages (login, invite, platform)
export function useStaffI18n(initial?: string): I18n {
  const [lang, setLangState] = useState<Locale>('en');
  useEffect(() => { setLangState(readStaffLang(initial === 'fr' ? 'fr' : 'en')); }, [initial]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l: Locale) => { writeStaffLang(l); setLangState(l); }, []);
  return {
    lang,
    t: (key, values) => ts(lang, key, values),
    label: (prefix, value) => labelOf(lang, prefix, value),
    fmt: (date, tz) => fmt(lang, date, tz),
    setLang
  };
}

export function LanguageToggle({ i18n }: { i18n: I18n }) {
  const other: Locale = i18n.lang === 'en' ? 'fr' : 'en';
  return <button type="button" className="underline" lang={other} onClick={() => i18n.setLang(other)}>{i18n.t('nav.language')}</button>;
}

const IDLE_MINUTES = 30;
const WARN_MINUTES = 28;

// Staff shell: bearer session, role-aware navigation, idle warning through
// an assertive live region with a "Stay signed in" control (F02), focus
// moved to the heading on navigation (F24), bilingual chrome (F25).
export function Shell({ children, title }: { children: (me: Me, i18n: I18n) => React.ReactNode; title: StaffKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState(false);
  const lastActivity = useRef(Date.now());
  const heading = useRef<HTMLHeadingElement>(null);
  const base = useStaffI18n(me?.language);
  // Switching language is a profile preference: the interface, staff emails and exports all follow it
  const i18n: I18n = { ...base, setLang: l => { base.setLang(l); if (me) staffApi.command('set-my-language', { language: l }).catch(() => { /* interface language still applies */ }); } };
  const { t } = i18n;

  const signOut = useCallback(async () => { try { await staffApi.command('sign-out', {}); } catch { /* ignore */ } setStaffToken(null); router.replace('/staff/login'); }, [router]);

  useEffect(() => {
    if (!staffToken()) { router.replace(`/staff/login?next=${encodeURIComponent(pathname)}`); return; }
    staffApi.query('me').then(m => { if (m.kind !== 'staff') router.replace('/staff/login'); else setMe(m); }).catch(() => router.replace(`/staff/login?next=${encodeURIComponent(pathname)}`));
  }, [pathname, router]);

  useEffect(() => { document.title = `${t(title)} · ${t('brand')}`; heading.current?.focus(); }, [title, pathname, t]);

  useEffect(() => {
    const bump = () => { lastActivity.current = Date.now(); };
    for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, bump);
    const timer = setInterval(() => {
      const idleMin = (Date.now() - lastActivity.current) / 60_000;
      if (idleMin >= IDLE_MINUTES) signOut();
      else setWarning(idleMin >= WARN_MINUTES);
    }, 15_000);
    return () => { clearInterval(timer); for (const ev of ['keydown', 'pointerdown']) window.removeEventListener(ev, bump); };
  }, [signOut]);

  const stay = async () => { lastActivity.current = Date.now(); setWarning(false); try { await staffApi.query('me'); } catch { setError(t('session.expired')); } };
  const nav: Array<[string, StaffKey]> = [['/staff', 'nav.processes'], ['/staff/settings', 'nav.settings']];

  return (
    <I18nContext.Provider value={i18n}>
      <a href="#main" className="skip-link">{t('skip')}</a>
      <header className="bg-white border-b border-gray-200">
        <nav aria-label={t('nav.label')} className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <a href="/staff" className="font-bold text-gray-900 no-underline">{t('brand')} · {me?.org.name ?? ''}</a>
          <ul className="flex flex-wrap gap-4 list-none m-0 p-0 items-center">
            {nav.map(([href, key]) => <li key={href}><a href={href} aria-current={pathname === href ? 'page' : undefined}>{t(key)}</a></li>)}
            {me ? <li className="text-sm text-gray-700">{me.displayName} ({me.roles.map(r => i18n.label('role', r)).join(', ')})</li> : null}
            <li><LanguageToggle i18n={i18n} /></li>
            <li><button type="button" className="btn-secondary" onClick={signOut}>{t('nav.signout')}</button></li>
          </ul>
        </nav>
      </header>
      {warning ? <div role="alert" aria-live="assertive" className="bg-yellow-100 border-b border-yellow-700 p-3 text-center">{t('idle.warning')} <button type="button" className="btn-primary ml-2" onClick={stay}>{t('idle.stay')}</button></div> : null}
      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto px-4 py-6">
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold mb-4">{t(title)}</h1>
        {error ? <p role="alert" className="field-error">{error}</p> : null}
        {me ? children(me, i18n) : <p role="status">{t('loading')}</p>}
      </main>
      <footer className="max-w-7xl mx-auto px-4 py-6"><Attribution lang={i18n.lang} /></footer>
    </I18nContext.Provider>
  );
}

export function useQuery<T>(name: string, params: Record<string, string>, deps: unknown[] = []): { data: T | null; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    staffApi.query(name, params).then(d => { if (alive) setData(d); }).catch(e => { if (alive) setError(`${e.error ?? 'error'}: ${e.message ?? ''}`); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, tick, ...deps]);
  return { data, error, reload: () => setTick(x => x + 1) };
}

export function Status({ message }: { message: string }) {
  return <div role="status" aria-live="polite" className={message ? 'mt-2 text-sm font-semibold' : 'sr-only'}>{message}</div>;
}

export function langMapInput(value: Record<string, string | undefined>, onChange: (v: Record<string, string>) => void, id: string, label: string, langs: Array<{ code: string }>, textarea = false) {
  return (
    <fieldset className="mb-3">
      <legend className="label">{label}</legend>
      {langs.map(l => (
        <div key={l.code} className="mb-2">
          <label htmlFor={`${id}-${l.code}`} className="text-sm font-semibold">{l.code.toUpperCase()}</label>
          {textarea
            ? <textarea id={`${id}-${l.code}`} className="input" rows={8} lang={l.code} value={value[l.code] ?? ''} onChange={e => onChange({ ...value, [l.code]: e.target.value } as Record<string, string>)} />
            : <input id={`${id}-${l.code}`} className="input" lang={l.code} value={value[l.code] ?? ''} onChange={e => onChange({ ...value, [l.code]: e.target.value } as Record<string, string>)} />}
        </div>
      ))}
    </fieldset>
  );
}

// Bilingual content shown in the viewer's language (falls back to the other one)
export function pick(map: Record<string, string | undefined> | undefined, lang: Locale): string {
  if (!map) return '';
  return map[lang] || map[lang === 'en' ? 'fr' : 'en'] || '';
}
