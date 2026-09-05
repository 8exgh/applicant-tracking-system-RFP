import type { Metadata } from 'next';
import '../../globals.css';
import { isLocale } from '@/lib/domain/lang';
import { t } from '@/lib/i18n/messages';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';

export const metadata: Metadata = { title: '8Examples ATS', description: 'Bilingual, accessible applicant tracking for Canadian public-interest employers' };

// Public and candidate pages: <html lang> per locale, skip link, landmarks,
// hreflang between the two languages (F24, F25).
export default async function PublicLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const other = lang === 'en' ? 'fr' : 'en';
  const h = await headers();
  const path = h.get('x-invoke-path') || h.get('next-url') || '';
  const otherPath = path.replace(new RegExp(`^/${lang}(/|$)`), `/${other}$1`) || `/${other}`;
  return (
    <html lang={lang}>
      <head>
        <link rel="alternate" hrefLang="en" href={`/en`} />
        <link rel="alternate" hrefLang="fr" href={`/fr`} />
      </head>
      <body>
        <a href="#main" className="skip-link">{t(lang, 'nav.skip')}</a>
        <header className="bg-white border-b border-gray-200">
          <nav aria-label={lang === 'fr' ? 'Navigation principale' : 'Main navigation'} className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap gap-4 items-center justify-between">
            <a href={`/${lang}/jobs`} className="font-bold text-gray-900 no-underline">8Examples ATS</a>
            <ul className="flex flex-wrap gap-4 list-none m-0 p-0">
              <li><a href={`/${lang}/me`}>{t(lang, 'nav.my_applications')}</a></li>
              <li><a href="/staff/login">{t(lang, 'nav.staff')}</a></li>
              <li><a href={otherPath.startsWith('/') ? otherPath : `/${other}`} lang={other} hrefLang={other}>{t(lang, 'nav.language')}</a></li>
            </ul>
          </nav>
        </header>
        <main id="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-6">{children}</main>
        <footer className="max-w-5xl mx-auto px-4 py-6 text-sm text-gray-700">
          <nav aria-label={lang === 'fr' ? 'Pied de page' : 'Footer'}>
            <ul className="flex gap-4 list-none m-0 p-0">
              <li><a href={`/${lang}/jobs`}>{t(lang, 'nav.jobs')}</a></li>
            </ul>
          </nav>
        </footer>
      </body>
    </html>
  );
}
