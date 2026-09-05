'use client';

import { useState } from 'react';
import { candidateApi, errorMessage } from '@/lib/ui/client-api';
import { LiveStatus, Banner } from '@/components/ui';
import { formatDateTime } from '@/lib/i18n/format';

type Data = Awaited<ReturnType<typeof import('@/lib/queries/candidate').candidateSlots>>;

// Slots as a list of buttons with full date, time and zone in the accessible name (F12)
export function Booking({ locale, applicationId, data, labels }: { locale: 'en' | 'fr'; applicationId: string; data: Data; labels: Record<string, string> }) {
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone || data.orgTimeZone;
  const [current, setCurrent] = useState(data.current);
  const [slots, setSlots] = useState(data.slots);
  const [status, setStatus] = useState('');
  const [cutoff, setCutoff] = useState(false);
  async function book(slotId: string) {
    try {
      const r = await candidateApi.command('book-interview', { applicationId, slotId });
      setCurrent({ slotId, at: r.at });
      setStatus(labels.booked.replace('{time}', formatDateTime(r.at, locale, viewerZone)));
    } catch (e) {
      const err = e as { error?: string };
      if (err.error === 'reschedule_cutoff_passed') setCutoff(true);
      else if (err.error === 'slot_no_longer_available') { setStatus(errorMessage(e)); const fresh = await candidateApi.query('candidate-slots', { applicationId }); setSlots(fresh.slots); }
      else setStatus(errorMessage(e));
    }
  }
  return (
    <>
      <p className="mb-3">{labels.zone.replace('{viewerZone}', viewerZone)}</p>
      {current ? <Banner kind="success">{labels.booked.replace('{time}', formatDateTime(current.at, locale, viewerZone))}</Banner> : null}
      {cutoff ? <Banner kind="warn">{labels.cutoff} {data.hrContact}</Banner> : null}
      <ul className="list-none p-0 m-0 grid gap-2">
        {slots.map(s => (
          <li key={s.slotId}>
            <button type="button" className="btn-secondary w-full justify-start" onClick={() => book(s.slotId)} aria-label={`${current ? labels.reschedule : labels.book}: ${formatDateTime(s.startsAt, locale, viewerZone)}`}>
              <time dateTime={s.startsAt}>{formatDateTime(s.startsAt, locale, viewerZone)}</time>
            </button>
          </li>
        ))}
      </ul>
      <LiveStatus message={status} />
    </>
  );
}
