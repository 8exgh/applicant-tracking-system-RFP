import { isLocale } from '@/lib/domain/lang';
import { organizationBySlug } from '@/lib/queries/public';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Privacy({ params }: { params: Promise<{ lang: string; org: string }> }) {
  const { lang, org } = await params;
  const locale = isLocale(lang) ? lang : 'en';
  const o = await organizationBySlug(org);
  if (!o) notFound();
  const version = (o.settings as { privacyNoticeVersion?: number }).privacyNoticeVersion ?? 1;
  return locale === 'fr' ? (
    <article>
      <h1 className="text-2xl font-bold mb-4">Avis de confidentialité (version {version})</h1>
      <p className="mb-3">{o.name} recueille les renseignements que vous fournissez dans votre candidature afin d’évaluer votre admissibilité et vos qualifications pour le poste visé, conformément aux lois applicables en matière de protection des renseignements personnels.</p>
      <p className="mb-3">Vos renseignements sont conservés au Canada, chiffrés avec une clé propre à votre dossier, et ne sont accessibles qu’au personnel autorisé. L’auto-déclaration et les demandes de mesures d’adaptation sont conservées séparément et ne sont jamais visibles par les gestionnaires ni par les évaluateurs.</p>
      <p className="mb-3">Vous pouvez demander une copie de vos données, corriger vos coordonnées ou demander leur suppression depuis votre page « Mes candidatures ». Cet avis ne constitue pas un avis juridique et sera revu par un conseiller juridique avant la mise en service.</p>
    </article>
  ) : (
    <article>
      <h1 className="text-2xl font-bold mb-4">Privacy notice (version {version})</h1>
      <p className="mb-3">{o.name} collects the information you provide in your application to assess your eligibility and qualifications for the position, in accordance with applicable privacy law.</p>
      <p className="mb-3">Your information is stored in Canada, encrypted with a key specific to your record, and readable only by authorized staff. Employment-equity self-declarations and accommodation requests are stored separately and are never visible to hiring managers or assessors.</p>
      <p className="mb-3">You can request a copy of your data, correct your contact details or request deletion from your “My applications” page. This notice is not legal advice and will be reviewed by counsel before go-live.</p>
    </article>
  );
}
