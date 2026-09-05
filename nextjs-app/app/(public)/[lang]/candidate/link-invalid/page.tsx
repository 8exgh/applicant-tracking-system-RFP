import { isLocale } from '@/lib/domain/lang';
import { t } from '@/lib/i18n/messages';

export default async function LinkInvalid({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : 'en';
  return (
    <>
      <h1 className="text-2xl font-bold mb-4">{t(locale, 'verify.expired')}</h1>
      <p><a href={`/${locale}/jobs`} className="btn-primary">{t(locale, 'verify.request_new')}</a></p>
    </>
  );
}
