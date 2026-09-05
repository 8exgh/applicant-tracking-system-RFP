import { notFound } from 'next/navigation';
import { getPoster } from '@/lib/queries/public';
import { isLocale } from '@/lib/domain/lang';
import { t } from '@/lib/i18n/messages';
import { ApplyForm } from './ApplyForm';

export const dynamic = 'force-dynamic';

export default async function Apply({ params, searchParams }: { params: Promise<{ lang: string; org: string; slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { lang, org, slug } = await params;
  const sp = await searchParams;
  const locale = isLocale(lang) ? lang : 'en';
  const result = await getPoster(org, slug, locale);
  if (!result || result.posting.status !== 'open') notFound();
  const source = sp.utm_source ? { source: sp.utm_source, medium: sp.utm_medium, campaign: sp.utm_campaign } : undefined;
  const next = `/${locale}/me/start?processId=${result.posting.processId}${source ? `&source=${encodeURIComponent(JSON.stringify(source))}` : ''}`;
  return (
    <>
      <h1 className="text-2xl font-bold mb-2">{t(locale, 'apply.title')}</h1>
      <p className="mb-4">{result.posting.title} · {result.posting.reference}</p>
      <ApplyForm org={org} locale={locale} next={next} labels={{ email: t(locale, 'apply.email'), help: t(locale, 'apply.email_help'), submit: t(locale, 'apply.submit'), sent: t(locale, 'apply.sent'), privacy: t(locale, 'apply.privacy'), missing: t(locale, 'form.missing'), errors: t(locale, 'a11y.error_summary') }} privacyHref={`/${locale}/${org}/privacy`} />
    </>
  );
}
