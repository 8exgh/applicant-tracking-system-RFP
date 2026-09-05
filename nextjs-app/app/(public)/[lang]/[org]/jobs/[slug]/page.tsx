import { notFound } from 'next/navigation';
import { getPoster } from '@/lib/queries/public';
import { isLocale } from '@/lib/domain/lang';
import { t } from '@/lib/i18n/messages';
import { Banner } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Poster({ params, searchParams }: { params: Promise<{ lang: string; org: string; slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { lang, org, slug } = await params;
  const sp = await searchParams;
  const locale = isLocale(lang) ? lang : 'en';
  const result = await getPoster(org, slug, locale);
  if (!result) notFound();
  const p = result.posting;
  const jobs = locale === 'fr' ? 'emplois' : 'jobs';
  const utm = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k.startsWith('utm_') && v) as [string, string][]).toString();
  return (
    <article>
      <h1 className="text-2xl font-bold mb-2" lang={p.titleLang !== locale ? p.titleLang : undefined}>{p.title}</h1>
      <p className="text-sm text-gray-700 mb-4">{t(locale, 'poster.reference')} {p.reference} · {t(locale, 'poster.version')} {p.version}{p.amendedAt ? ` · ${t(locale, 'poster.amended')} ${new Date(p.amendedAt).toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA')}` : ''}</p>
      {p.status !== 'open' ? <Banner kind="warn">{t(locale, 'poster.closed_banner')}</Banner> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 mb-4">
        <dt className="font-semibold">{t(locale, 'careers.location')}</dt><dd>{p.location ?? '—'}</dd>
        <dt className="font-semibold">{t(locale, 'careers.closes')}</dt><dd><time dateTime={p.closeAt ?? undefined}>{p.closeAtText}</time></dd>
      </dl>
      {p.fallback ? <p className="mb-2 italic">{t(locale, 'poster.fallback_notice')}</p> : null}
      <section aria-labelledby="poster-body" className="card prose-poster mb-6" lang={p.fallback ? p.bodyLang : undefined}>
        <h2 id="poster-body" className="sr-only">{p.title}</h2>
        {p.body}
      </section>
      {p.status === 'open' ? <a href={`/${locale}/${org}/${jobs}/${slug}/apply${utm ? `?${utm}` : ''}`} className="btn-primary">{t(locale, 'poster.apply')}</a> : null}
    </article>
  );
}
