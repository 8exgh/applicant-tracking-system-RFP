import { redirect, notFound } from 'next/navigation';
import { candidateSession } from '@/lib/ui/candidate-session';
import { candidateSlots } from '@/lib/queries/candidate';
import { isLocale } from '@/lib/domain/lang';
import { t } from '@/lib/i18n/messages';
import { Booking } from './Booking';

export const dynamic = 'force-dynamic';

export default async function Interviews({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang, id } = await params;
  const locale = isLocale(lang) ? lang : 'en';
  const session = await candidateSession();
  if (!session) redirect(`/${locale}/jobs`);
  let data;
  try { data = await candidateSlots(session.tenantId, session.candidateId, id); } catch { notFound(); }
  return (
    <>
      <h1 className="text-2xl font-bold mb-4">{t(locale, 'interview.title')}</h1>
      <Booking locale={locale} applicationId={id} data={data} labels={{ book: t(locale, 'interview.book'), reschedule: t(locale, 'interview.reschedule'), cutoff: t(locale, 'interview.cutoff'), booked: t(locale, 'interview.booked', { time: '{time}' }), zone: t(locale, 'interview.zone_note', { viewerZone: '{viewerZone}', orgZone: data.orgTimeZone }) }} />
    </>
  );
}
