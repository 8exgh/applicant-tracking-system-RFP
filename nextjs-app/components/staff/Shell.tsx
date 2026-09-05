'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { staffApi, setStaffToken, staffToken } from '@/lib/ui/client-api';

export interface Me { kind: string; userId: string; tenantId: string; roles: string[]; displayName: string; language: string; email: string; org: { name: string; slug: string; timeZone: string; languages: Array<{ code: 'en' | 'fr'; required: boolean }>; settings: Record<string, unknown>; featureFlags: Record<string, boolean> }; users: Array<{ userId: string; displayName: string; roles: string[]; status: string }>; }

const IDLE_MINUTES = 30;
const WARN_MINUTES = 28;

// Staff shell: bearer session, role-aware navigation, idle warning through
// an assertive live region with a "Stay signed in" control (F02), focus
// moved to the heading on navigation (F24).
export function Shell({ children, title }: { children: (me: Me) => React.ReactNode; title: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState(false);
  const lastActivity = useRef(Date.now());
  const heading = useRef<HTMLHeadingElement>(null);

  const signOut = useCallback(async () => { try { await staffApi.command('sign-out', {}); } catch { /* ignore */ } setStaffToken(null); router.replace('/staff/login'); }, [router]);

  useEffect(() => {
    if (!staffToken()) { router.replace(`/staff/login?next=${encodeURIComponent(pathname)}`); return; }
    staffApi.query('me').then(m => { if (m.kind !== 'staff') router.replace('/staff/login'); else setMe(m); }).catch(() => router.replace(`/staff/login?next=${encodeURIComponent(pathname)}`));
  }, [pathname, router]);

  useEffect(() => { document.title = `${title} · ATS`; heading.current?.focus(); }, [title, pathname]);

  useEffect(() => {
    const bump = () => { lastActivity.current = Date.now(); };
    for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, bump);
    const t = setInterval(() => {
      const idleMin = (Date.now() - lastActivity.current) / 60_000;
      if (idleMin >= IDLE_MINUTES) signOut();
      else setWarning(idleMin >= WARN_MINUTES);
    }, 15_000);
    return () => { clearInterval(t); for (const ev of ['keydown', 'pointerdown']) window.removeEventListener(ev, bump); };
  }, [signOut]);

  const stay = async () => { lastActivity.current = Date.now(); setWarning(false); try { await staffApi.query('me'); } catch { setError('Session expired'); } };
  const nav = [['/staff', 'Processes'], ['/staff/settings', 'Settings']];

  return (
    <>
      <a href="#main" className="skip-link">Skip to main content</a>
      <header className="bg-white border-b border-gray-200">
        <nav aria-label="Staff navigation" className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <a href="/staff" className="font-bold text-gray-900 no-underline">ATS · {me?.org.name ?? ''}</a>
          <ul className="flex flex-wrap gap-4 list-none m-0 p-0 items-center">
            {nav.map(([href, label]) => <li key={href}><a href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</a></li>)}
            {me ? <li className="text-sm text-gray-700">{me.displayName} ({me.roles.join(', ')})</li> : null}
            <li><button type="button" className="btn-secondary" onClick={signOut}>Sign out</button></li>
          </ul>
        </nav>
      </header>
      {warning ? <div role="alert" aria-live="assertive" className="bg-yellow-100 border-b border-yellow-700 p-3 text-center">Your session will end in 2 minutes due to inactivity. <button type="button" className="btn-primary ml-2" onClick={stay}>Stay signed in</button></div> : null}
      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto px-4 py-6">
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold mb-4">{title}</h1>
        {error ? <p role="alert" className="field-error">{error}</p> : null}
        {me ? children(me) : <p role="status">Loading…</p>}
      </main>
    </>
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
  return { data, error, reload: () => setTick(t => t + 1) };
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
