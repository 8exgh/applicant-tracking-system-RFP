import { DomainError } from './errors';
import { DecidedEvent, ReplayEvent } from '@/types/events';
import { LanguageSetting, Locale, PLACEHOLDER_VOCABULARY } from '@/types/shared';
import { requiredLanguages } from './lang';

// Templates are versioned per language with a fixed placeholder vocabulary (§9.7)
export interface TemplateVersion { lang: Locale; version: number; subject: string; body: string; }
export interface TemplateState { key: string; versions: TemplateVersion[]; active: boolean; }

export const TEMPLATE_KEYS = [
  'application_submitted', 'application_withdrawn', 'closing_date_extended', 'posting_amended', 'process_cancelled',
  'screened_out', 'screened_in', 'stage_update', 'interview_invitation', 'interview_confirmation', 'interview_rescheduled',
  'interview_cancelled', 'interview_reminder', 'exam_assigned', 'offer_sent', 'offer_accepted', 'offer_rescinded',
  'magic_link', 'staff_invitation', 'approval_requested', 'approval_decided', 'accommodation_requested', 'data_export_ready',
  'deletion_deferred', 'email_change'
] as const;
export type TemplateKey = typeof TEMPLATE_KEYS[number];

export function initialTemplateState(key: string): TemplateState {
  return { key, versions: [], active: false };
}

export function evolveTemplate(state: TemplateState, event: ReplayEvent): TemplateState {
  const p = event.payload as Record<string, any>;
  switch (event.type) {
    case 'NotificationTemplateSaved':
      return { ...state, versions: [...state.versions, { lang: p.lang, version: p.version, subject: p.subject, body: p.body }] };
    case 'NotificationTemplateActivated':
      return { ...state, active: true };
    default:
      return state;
  }
}

export function currentVersion(state: TemplateState, lang: Locale): TemplateVersion | undefined {
  return [...state.versions].reverse().find(v => v.lang === lang);
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function unknownPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER)) if (!PLACEHOLDER_VOCABULARY.includes(m[1])) found.add(m[1]);
  return Array.from(found);
}

export function decideSaveTemplate(state: TemplateState, cmd: { lang: Locale; subject: string; body: string }): DecidedEvent[] {
  const unknown = [...unknownPlaceholders(cmd.subject), ...unknownPlaceholders(cmd.body)];
  if (unknown.length) throw new DomainError('unknown_placeholder', `Unknown placeholder(s): ${unknown.join(', ')}`, { placeholders: unknown });
  if (!cmd.subject.trim() || !cmd.body.trim()) throw new DomainError('content_required');
  const version = state.versions.filter(v => v.lang === cmd.lang).length + 1;
  return [{ type: 'NotificationTemplateSaved', payload: { key: state.key, lang: cmd.lang, version, subject: cmd.subject, body: cmd.body } }];
}

export function decideActivateTemplate(state: TemplateState, languages: LanguageSetting[]): DecidedEvent[] {
  const missing = requiredLanguages(languages).filter(l => !currentVersion(state, l));
  if (missing.length) throw new DomainError('missing_language_content', 'Template content missing in a required language', { missing });
  if (state.active) return [];
  return [{ type: 'NotificationTemplateActivated', payload: { key: state.key } }];
}

export function render(text: string, values: Record<string, string | undefined>): string {
  return text.replace(PLACEHOLDER, (_, name: string) => values[name] ?? '');
}

// Built-in bilingual defaults so a fresh organization can notify from day one
export const DEFAULT_TEMPLATES: Record<TemplateKey, Record<Locale, { subject: string; body: string }>> = {
  application_submitted: {
    en: { subject: 'Application received: {{process_title}} ({{reference}})', body: 'Hello {{candidate_name}},\n\nWe received your application for {{process_title}} ({{reference}}). The posting closes {{closing_time}}. You can review your application until then at {{link}}.\n\n{{organization_name}}' },
    fr: { subject: 'Candidature reçue : {{process_title}} ({{reference}})', body: 'Bonjour {{candidate_name}},\n\nNous avons reçu votre candidature pour {{process_title}} ({{reference}}). L’affichage se termine le {{closing_time}}. Vous pouvez revoir votre candidature jusque-là à {{link}}.\n\n{{organization_name}}' }
  },
  application_withdrawn: {
    en: { subject: 'Application withdrawn: {{process_title}}', body: 'Hello {{candidate_name}},\n\nYour application for {{process_title}} ({{reference}}) has been withdrawn as requested.\n\n{{organization_name}}' },
    fr: { subject: 'Candidature retirée : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nVotre candidature pour {{process_title}} ({{reference}}) a été retirée comme demandé.\n\n{{organization_name}}' }
  },
  closing_date_extended: {
    en: { subject: 'Closing date extended: {{process_title}}', body: 'Hello {{candidate_name}},\n\nThe closing date for {{process_title}} ({{reference}}) is now {{closing_time}}.\n\n{{organization_name}}' },
    fr: { subject: 'Date de clôture prolongée : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nLa date de clôture de {{process_title}} ({{reference}}) est maintenant le {{closing_time}}.\n\n{{organization_name}}' }
  },
  posting_amended: {
    en: { subject: 'Posting amended: {{process_title}}', body: 'Hello {{candidate_name}},\n\nThe posting for {{process_title}} ({{reference}}) was amended: {{reason}}. See the current version at {{link}}.\n\n{{organization_name}}' },
    fr: { subject: 'Affichage modifié : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nL’affichage de {{process_title}} ({{reference}}) a été modifié : {{reason}}. Consultez la version en vigueur à {{link}}.\n\n{{organization_name}}' }
  },
  process_cancelled: {
    en: { subject: 'Process cancelled: {{process_title}}', body: 'Hello {{candidate_name}},\n\nThe hiring process {{process_title}} ({{reference}}) has been cancelled. Thank you for your interest.\n\n{{organization_name}}' },
    fr: { subject: 'Processus annulé : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nLe processus de dotation {{process_title}} ({{reference}}) a été annulé. Merci de votre intérêt.\n\n{{organization_name}}' }
  },
  screened_out: {
    en: { subject: 'Screening result: {{process_title}}', body: 'Hello {{candidate_name}},\n\nThank you for applying to {{process_title}} ({{reference}}). After screening, your application will not proceed to assessment.\n\n{{organization_name}}' },
    fr: { subject: 'Résultat de la présélection : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nMerci d’avoir postulé à {{process_title}} ({{reference}}). Après la présélection, votre candidature ne sera pas retenue pour l’évaluation.\n\n{{organization_name}}' }
  },
  screened_in: {
    en: { subject: 'You are moving forward: {{process_title}}', body: 'Hello {{candidate_name}},\n\nYour application for {{process_title}} ({{reference}}) has been screened in. Status: {{stage_label}}.\n\n{{organization_name}}' },
    fr: { subject: 'Votre candidature est retenue : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nVotre candidature pour {{process_title}} ({{reference}}) a été retenue à la présélection. État : {{stage_label}}.\n\n{{organization_name}}' }
  },
  stage_update: {
    en: { subject: 'Update on your application: {{process_title}}', body: 'Hello {{candidate_name}},\n\nYour application for {{process_title}} ({{reference}}) is now: {{stage_label}}. Details: {{link}}\n\n{{organization_name}}' },
    fr: { subject: 'Mise à jour de votre candidature : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nVotre candidature pour {{process_title}} ({{reference}}) est maintenant : {{stage_label}}. Détails : {{link}}\n\n{{organization_name}}' }
  },
  interview_invitation: {
    en: { subject: 'Interview invitation: {{process_title}}', body: 'Hello {{candidate_name}},\n\nYou are invited to an interview for {{process_title}} ({{reference}}). Choose a time at {{link}}.\n\n{{organization_name}}' },
    fr: { subject: 'Invitation à une entrevue : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nVous êtes invité·e à une entrevue pour {{process_title}} ({{reference}}). Choisissez un moment à {{link}}.\n\n{{organization_name}}' }
  },
  interview_confirmation: {
    en: { subject: 'Interview confirmed: {{interview_time}}', body: 'Hello {{candidate_name}},\n\nYour interview for {{process_title}} ({{reference}}) is confirmed for {{interview_time}}. Manage it at {{link}}.\n\n{{organization_name}}' },
    fr: { subject: 'Entrevue confirmée : {{interview_time}}', body: 'Bonjour {{candidate_name}},\n\nVotre entrevue pour {{process_title}} ({{reference}}) est confirmée pour le {{interview_time}}. Gérez-la à {{link}}.\n\n{{organization_name}}' }
  },
  interview_rescheduled: {
    en: { subject: 'Interview rescheduled: {{interview_time}}', body: 'Hello {{candidate_name}},\n\nYour interview for {{process_title}} is now {{interview_time}}.\n\n{{organization_name}}' },
    fr: { subject: 'Entrevue reportée : {{interview_time}}', body: 'Bonjour {{candidate_name}},\n\nVotre entrevue pour {{process_title}} est maintenant le {{interview_time}}.\n\n{{organization_name}}' }
  },
  interview_cancelled: {
    en: { subject: 'Interview cancelled: {{process_title}}', body: 'Hello {{candidate_name}},\n\nYour interview for {{process_title}} was cancelled: {{reason}}. We will be in touch.\n\n{{organization_name}}' },
    fr: { subject: 'Entrevue annulée : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nVotre entrevue pour {{process_title}} a été annulée : {{reason}}. Nous vous recontacterons.\n\n{{organization_name}}' }
  },
  interview_reminder: {
    en: { subject: 'Reminder: interview {{interview_time}}', body: 'Hello {{candidate_name}},\n\nA reminder of your interview for {{process_title}} on {{interview_time}}.\n\n{{organization_name}}' },
    fr: { subject: 'Rappel : entrevue le {{interview_time}}', body: 'Bonjour {{candidate_name}},\n\nRappel de votre entrevue pour {{process_title}} le {{interview_time}}.\n\n{{organization_name}}' }
  },
  exam_assigned: {
    en: { subject: 'Written exam: {{process_title}}', body: 'Hello {{candidate_name}},\n\nA written exam for {{process_title}} is available between {{window_start}} and {{window_end}} at {{link}}.\n\n{{organization_name}}' },
    fr: { subject: 'Examen écrit : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nUn examen écrit pour {{process_title}} est disponible entre le {{window_start}} et le {{window_end}} à {{link}}.\n\n{{organization_name}}' }
  },
  offer_sent: {
    en: { subject: 'Offer of employment: {{process_title}}', body: 'Hello {{candidate_name}},\n\nAn offer for {{position}} is waiting for you at {{link}}. It expires {{offer_expiry}}.\n\n{{organization_name}}' },
    fr: { subject: 'Offre d’emploi : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nUne offre pour le poste {{position}} vous attend à {{link}}. Elle expire le {{offer_expiry}}.\n\n{{organization_name}}' }
  },
  offer_accepted: {
    en: { subject: 'Offer accepted: {{candidate_name}}', body: '{{candidate_name}} accepted the offer for {{position}} ({{reference}}). Start date: {{start_date}}.' },
    fr: { subject: 'Offre acceptée : {{candidate_name}}', body: '{{candidate_name}} a accepté l’offre pour {{position}} ({{reference}}). Date d’entrée en fonction : {{start_date}}.' }
  },
  offer_rescinded: {
    en: { subject: 'Offer withdrawn: {{process_title}}', body: 'Hello {{candidate_name}},\n\nThe offer for {{position}} has been withdrawn: {{reason}}.\n\n{{organization_name}}' },
    fr: { subject: 'Offre retirée : {{process_title}}', body: 'Bonjour {{candidate_name}},\n\nL’offre pour {{position}} a été retirée : {{reason}}.\n\n{{organization_name}}' }
  },
  magic_link: {
    en: { subject: 'Your sign-in link for {{organization_name}}', body: 'Use this link to sign in. It works once and expires in 15 minutes:\n\n{{link}}\n\nIf you did not request it, ignore this message.' },
    fr: { subject: 'Votre lien de connexion pour {{organization_name}}', body: 'Utilisez ce lien pour vous connecter. Il fonctionne une seule fois et expire dans 15 minutes :\n\n{{link}}\n\nSi vous n’avez rien demandé, ignorez ce message.' }
  },
  staff_invitation: {
    en: { subject: 'You have been invited to {{organization_name}}', body: 'Set your password and sign in: {{link}}' },
    fr: { subject: 'Vous êtes invité·e à {{organization_name}}', body: 'Définissez votre mot de passe et connectez-vous : {{link}}' }
  },
  approval_requested: {
    en: { subject: 'Approval requested: {{process_title}} ({{reference}})', body: 'A hiring process is waiting for your approval: {{link}}' },
    fr: { subject: 'Approbation demandée : {{process_title}} ({{reference}})', body: 'Un processus de dotation attend votre approbation : {{link}}' }
  },
  approval_decided: {
    en: { subject: 'Approval decision: {{process_title}} ({{reference}})', body: '{{reason}}\n\n{{link}}' },
    fr: { subject: 'Décision d’approbation : {{process_title}} ({{reference}})', body: '{{reason}}\n\n{{link}}' }
  },
  accommodation_requested: {
    en: { subject: 'Accommodation request: {{process_title}}', body: 'A candidate submitted an accommodation request on {{process_title}} ({{reference}}). Review it: {{link}}' },
    fr: { subject: 'Demande de mesures d’adaptation : {{process_title}}', body: 'Une personne candidate a soumis une demande de mesures d’adaptation pour {{process_title}} ({{reference}}). Consultez-la : {{link}}' }
  },
  data_export_ready: {
    en: { subject: 'Your data export is ready', body: 'Hello {{candidate_name}},\n\nDownload your data at {{link}}. The link expires {{offer_expiry}}.' },
    fr: { subject: 'Votre exportation de données est prête', body: 'Bonjour {{candidate_name}},\n\nTéléchargez vos données à {{link}}. Le lien expire le {{offer_expiry}}.' }
  },
  deletion_deferred: {
    en: { subject: 'Your deletion request', body: 'Hello {{candidate_name}},\n\nYour data is part of an active hiring process and will be deleted on {{closing_time}}. You may withdraw your application instead at {{link}}.' },
    fr: { subject: 'Votre demande de suppression', body: 'Bonjour {{candidate_name}},\n\nVos données font partie d’un processus de dotation en cours et seront supprimées le {{closing_time}}. Vous pouvez plutôt retirer votre candidature à {{link}}.' }
  },
  email_change: {
    en: { subject: 'Confirm your new email address', body: 'Confirm your new address for {{organization_name}}: {{link}}' },
    fr: { subject: 'Confirmez votre nouvelle adresse courriel', body: 'Confirmez votre nouvelle adresse pour {{organization_name}} : {{link}}' }
  }
};
