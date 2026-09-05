import { isLocale } from '@/lib/domain/lang';

export default async function Accessibility({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : 'en';
  return locale === 'fr' ? (
    <article><h1 className="text-2xl font-bold mb-4">Déclaration d’accessibilité</h1><p>Ce service vise la conformité WCAG 2.1 niveau AA. Aucune page ne présente de CAPTCHA. Pour signaler un obstacle, écrivez à l’adresse indiquée sur l’affichage.</p></article>
  ) : (
    <article><h1 className="text-2xl font-bold mb-4">Accessibility statement</h1><p>This service targets WCAG 2.1 Level AA. No page presents a CAPTCHA. To report a barrier, write to the contact address shown on the posting.</p></article>
  );
}
