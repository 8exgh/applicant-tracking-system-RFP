import { redirect } from 'next/navigation';
import { candidateSession } from '@/lib/ui/candidate-session';
import { isLocale } from '@/lib/domain/lang';

export const dynamic = 'force-dynamic';

export default async function ExportPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : 'en';
  const session = await candidateSession();
  if (!session) redirect(`/${locale}/jobs`);
  return (
    <>
      <h1 className="text-2xl font-bold mb-4">{locale === 'fr' ? 'Vos données' : 'Your data'}</h1>
      <p><a href="/api/queries/my-data-export" className="btn-primary" download="my-data.json">{locale === 'fr' ? 'Télécharger (JSON)' : 'Download (JSON)'}</a></p>
    </>
  );
}
