import { redirect } from 'next/navigation';

export default async function LangHome({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const org = process.env.DEFAULT_ORG_SLUG;
  redirect(org ? `/${lang}/${org}/jobs` : `/${lang}/jobs`);
}
