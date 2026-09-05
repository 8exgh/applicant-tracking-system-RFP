'use client';

import { useEffect, useRef } from 'react';

// Status messages use a polite live region and never steal focus (F24)
export function LiveStatus({ message }: { message: string }) {
  return <div role="status" aria-live="polite" className="sr-only">{message}</div>;
}

// Error summary receives focus and links each error to its field (F07, F24)
export function ErrorSummary({ title, errors }: { title: string; errors: Array<{ id: string; message: string }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (errors.length) ref.current?.focus(); }, [errors]);
  if (!errors.length) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="border-2 border-red-800 bg-red-50 p-4 rounded mb-4">
      <h2 className="font-bold text-red-900 mb-2">{title}</h2>
      <ul className="list-disc pl-5">
        {errors.map(e => <li key={e.id}><a href={`#${e.id}`} className="text-red-900 underline" onClick={ev => { ev.preventDefault(); document.getElementById(e.id)?.focus(); }}>{e.message}</a></li>)}
      </ul>
    </div>
  );
}

export function Field({ id, label, help, error, required, children }: { id: string; label: string; help?: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="label">{label}{required ? <span className="text-red-800"> *</span> : null}</label>
      {help ? <p id={`${id}-help`} className="help mb-1">{help}</p> : null}
      {children}
      {error ? <p id={`${id}-error`} className="field-error">{error}</p> : null}
    </div>
  );
}

export function Banner({ kind, children }: { kind: 'info' | 'warn' | 'success'; children: React.ReactNode }) {
  const cls = kind === 'warn' ? 'bg-yellow-50 border-yellow-700' : kind === 'success' ? 'bg-green-50 border-green-700' : 'bg-blue-50 border-blue-700';
  return <div className={`border-l-4 p-3 mb-4 ${cls}`} role={kind === 'warn' ? 'alert' : undefined}>{children}</div>;
}
