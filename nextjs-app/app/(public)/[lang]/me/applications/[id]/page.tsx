import { redirect, notFound } from 'next/navigation';
import { candidateSession } from '@/lib/ui/candidate-session';
import { applicationForm } from '@/lib/queries/candidate';
import { isLocale } from '@/lib/domain/lang';
import { t, MessageKey } from '@/lib/i18n/messages';
import { ApplicationForm } from './ApplicationForm';

export const dynamic = 'force-dynamic';

export default async function ApplicationPage({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang, id } = await params;
  const locale = isLocale(lang) ? lang : 'en';
  const session = await candidateSession();
  if (!session) redirect(`/${locale}/jobs`);
  let form;
  try { form = await applicationForm(session.tenantId, session.candidateId, id, locale); } catch { notFound(); }
  const keys: MessageKey[] = ['form.title', 'form.contact', 'form.name', 'form.phone', 'form.questions', 'form.required', 'form.optional', 'form.knockout', 'form.yes', 'form.no', 'form.documents', 'form.upload', 'form.remove', 'form.consent', 'form.save', 'form.saved', 'form.submit', 'form.resubmit', 'form.errors', 'form.missing', 'form.remaining', 'form.self_declaration', 'form.self_declaration_help', 'form.self_declaration_skip', 'form.self_declaration_save', 'form.self_declaration_withdraw', 'form.accommodation', 'form.accommodation_help', 'form.accommodation_contact', 'form.accommodation_send', 'form.withdraw', 'form.withdraw_reason', 'confirm.title', 'status.history', 'status.status', 'a11y.error_summary', 'interview.title', 'offer.title'];
  const labels = Object.fromEntries(keys.map(k => [k, t(locale, k)])) as Record<MessageKey, string>;
  return <ApplicationForm locale={locale} form={form} labels={labels} closedText={t(locale, 'form.closed', { closeAt: form.process.closeAtText })} confirmText={t(locale, 'confirm.body', { title: form.process.title, reference: form.process.reference, closeAt: form.process.closeAtText })} />;
}
