import { notFound } from 'next/navigation';
import { listOpenPostings } from '@/lib/queries/public';
import { isLocale } from '@/lib/domain/lang';
import { t } from '@/lib/i18n/messages';

export const dynamic = 'force-dynamic';

export default async function Careers({ params }: { params: Promise<{ lang: string; org: string }> }) {
  const { lang, org } = await params;
  const locale = isLocale(lang) ? lang : 'en';
  const result = await listOpenPostings(org, locale);
  if (!result) notFound();
  const jobs = locale === 'fr' ? 'emplois' : 'jobs';
  return (
    <>
      <h1 className="text-2xl font-bold mb-1">{result.org.name}</h1>
      <h2 className="text-xl mb-4">{t(locale, 'careers.title')}</h2>
      {result.postings.length === 0 ? <p>{t(locale, 'careers.none')}</p> : (
        <ul className="list-none p-0 m-0 grid gap-3">
          {result.postings.map(p => (
            <li key={p.processId} className="card">
              <h3 className="text-lg font-semibold"><a href={`/${locale}/${org}/${jobs}/${p.slug}`} lang={p.titleLang !== locale ? p.titleLang : undefined}>{p.title}</a></h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm mt-1">
                <dt className="font-semibold">{t(locale, 'careers.location')}</dt><dd>{p.location ?? '—'}</dd>
                <dt className="font-semibold">{t(locale, 'careers.closes')}</dt><dd><time dateTime={p.closeAt ?? undefined}>{p.closeAtText}</time></dd>
                <dt className="font-semibold">{t(locale, 'poster.reference')}</dt><dd>{p.reference}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-sm"><a href={`/api/public/${org}/feed.json`}>JSON</a> · <a href={`/api/public/${org}/feed.xml?lang=${locale}`}>RSS</a></p>
    </>
  );
}
