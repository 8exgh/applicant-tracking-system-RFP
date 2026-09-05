import { redirect, notFound } from 'next/navigation';
import { candidateSession } from '@/lib/ui/candidate-session';
import { applicationForm } from '@/lib/queries/candidate';
import { isLocale } from '@/lib/domain/lang';
import { Exam } from './Exam';

export const dynamic = 'force-dynamic';

export default async function ExamPage({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang, id } = await params;
  const locale = isLocale(lang) ? lang : 'en';
  const session = await candidateSession();
  if (!session) redirect(`/${locale}/jobs`);
  let form;
  try { form = await applicationForm(session.tenantId, session.candidateId, id, locale); } catch { notFound(); }
  if (!form.exam) notFound();
  const criterion = form.process.criteria.find(c => c.code === form.exam!.criterionCode);
  return <Exam locale={locale} applicationId={id} exam={form.exam} question={criterion?.text.text ?? form.exam.criterionCode} timeZone={form.org.timeZone} />;
}
