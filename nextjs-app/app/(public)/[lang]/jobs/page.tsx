import { redirect } from 'next/navigation';
import { withPlatform } from '@/lib/db/pool';
import { isLocale } from '@/lib/domain/lang';
import { t } from '@/lib/i18n/messages';

export const dynamic = 'force-dynamic';

// Organization directory (one deployment hosts several organizations)
export default async function Directory({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : 'en';
  if (process.env.DEFAULT_ORG_SLUG) redirect(`/${locale}/${process.env.DEFAULT_ORG_SLUG}/jobs`);
  const orgs = await withPlatform(async tx => (await tx.query("select slug, name from org_settings where status = 'Active' order by name")).rows);
  return (
    <>
      <h1 className="text-2xl font-bold mb-4">{t(locale, 'careers.title')}</h1>
      {orgs.length === 0 ? <p>{t(locale, 'careers.none')}</p> : (
        <ul className="list-none p-0 m-0 grid gap-3">
          {orgs.map((o: { slug: string; name: string }) => <li key={o.slug} className="card"><a href={`/${locale}/${o.slug}/jobs`} className="font-semibold">{o.name}</a></li>)}
        </ul>
      )}
    </>
  );
}
