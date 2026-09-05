import { redirect, notFound } from 'next/navigation';
import { candidateSession } from '@/lib/ui/candidate-session';
import { applicationForm } from '@/lib/queries/candidate';
import { isLocale } from '@/lib/domain/lang';
import { t } from '@/lib/i18n/messages';
import { OfferActions } from './OfferActions';

export const dynamic = 'force-dynamic';

export default async function OfferPage({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang, id } = await params;
  const locale = isLocale(lang) ? lang : 'en';
  const session = await candidateSession();
  if (!session) redirect(`/${locale}/jobs`);
  let form;
  try { form = await applicationForm(session.tenantId, session.candidateId, id, locale); } catch { notFound(); }
  if (!form.offer) notFound();
  const o = form.offer;
  return (
    <article>
      <h1 className="text-2xl font-bold mb-2">{t(locale, 'offer.title')}: {o.fields.position}</h1>
      <p className="mb-4">{form.process.title} · {form.process.reference}</p>
      <dl className="card grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mb-4">
        <dt className="font-semibold">{locale === 'fr' ? 'Poste' : 'Position'}</dt><dd>{o.fields.position}</dd>
        <dt className="font-semibold">{locale === 'fr' ? 'Date d’entrée en fonction' : 'Start date'}</dt><dd>{o.fields.startDate}</dd>
        <dt className="font-semibold">{locale === 'fr' ? 'Salaire' : 'Salary'}</dt><dd>{o.fields.salary}</dd>
      </dl>
      {o.fields.letter ? <section className="card prose-poster mb-4">{o.fields.letter}</section> : null}
      {o.status === 'Sent' ? <p className="mb-3">{t(locale, 'offer.expires', { time: o.expiresAtText })}</p> : null}
      {o.status === 'Accepted' ? <p className="mb-3 font-semibold">{t(locale, 'offer.accepted', { time: o.acceptedAtText })}</p> : null}
      {o.status === 'Expired' ? <p className="mb-3 font-semibold">{t(locale, 'offer.expired')}</p> : null}
      {o.status === 'Sent' ? <OfferActions applicationId={id} offerId={o.offerId} labels={{ accept: t(locale, 'offer.accept'), decline: t(locale, 'offer.decline'), typedName: t(locale, 'offer.typed_name'), missing: t(locale, 'form.missing'), errors: t(locale, 'a11y.error_summary') }} /> : null}
    </article>
  );
}
