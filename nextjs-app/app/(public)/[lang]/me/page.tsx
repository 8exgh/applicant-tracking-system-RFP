import { redirect } from 'next/navigation';
import { candidateSession } from '@/lib/ui/candidate-session';
import { myApplications, myProfile } from '@/lib/queries/candidate';
import { isLocale } from '@/lib/domain/lang';
import { t } from '@/lib/i18n/messages';
import { PrivacyControls } from './PrivacyControls';

export const dynamic = 'force-dynamic';

export default async function Me({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : 'en';
  const session = await candidateSession();
  if (!session) redirect(`/${locale}/jobs`);
  const apps = await myApplications(session.tenantId, session.candidateId, locale);
  const profile = await myProfile(session.tenantId, session.candidateId);
  return (
    <>
      <h1 className="text-2xl font-bold mb-4">{t(locale, 'status.title')}</h1>
      {apps.length === 0 ? <p>{t(locale, 'status.none')}</p> : (
        <ul className="list-none p-0 m-0 grid gap-3">
          {apps.map(a => (
            <li key={a.applicationId} className="card">
              <h2 className="text-lg font-semibold"><a href={`/${locale}/me/applications/${a.applicationId}`}>{a.title}</a> <span className="text-sm text-gray-700">({a.reference})</span></h2>
              <p><strong>{t(locale, 'status.status')}:</strong> {a.stageLabel ?? t(locale, `status.${a.status}` as never)}</p>
              {a.offer && a.offer.status === 'Sent' ? <p><a href={`/${locale}/me/offers/${a.applicationId}`} className="btn-primary mt-2">{t(locale, 'offer.title')}</a></p> : null}
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="privacy" className="card mt-8">
        <h2 id="privacy" className="text-lg font-semibold mb-2">{t(locale, 'status.privacy')}</h2>
        <PrivacyControls locale={locale} profile={{ name: profile.profile.name ?? '', phone: profile.profile.phone ?? '', email: profile.email ?? '', marketingOptOut: profile.marketingOptOut, deletionDeferredUntil: profile.deletionDeferredUntil }} labels={{ name: t(locale, 'form.name'), phone: t(locale, 'form.phone'), save: t(locale, 'form.save'), saved: t(locale, 'form.saved'), export: t(locale, 'status.export'), del: t(locale, 'status.delete'), language: t(locale, 'status.language'), marketing: t(locale, 'status.marketing'), email: t(locale, 'apply.email') }} />
      </section>
    </>
  );
}
