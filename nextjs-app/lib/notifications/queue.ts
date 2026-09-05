import { randomUUID } from 'crypto';
import { Tx } from '@/lib/db/pool';
import { Appender } from '@/lib/commands/execute';
import { decryptField, encryptField, candidateKeyId } from '@/lib/crypto/pii';
import { DEFAULT_TEMPLATES, TemplateKey, render } from '@/lib/domain/notification';
import { requiredLanguages } from '@/lib/domain/lang';
import { streamIds } from '@/types/events';
import { LanguageSetting, Locale } from '@/types/shared';
import { getLogger } from '@/lib/logger';

const log = getLogger('notifications/queue');

export type Recipient =
  | { kind: 'candidate'; candidateId: string }
  | { kind: 'staff'; userId: string }
  | { kind: 'email'; address: string; locale: Locale; ref: string; keyId: string };

export interface QueueParams {
  tenantId: string;
  templateKey: TemplateKey;
  recipient: Recipient;
  values: Record<string, string | undefined>;
  causation: { eventType: string; eventId?: string };
  processId?: string;
  applicationId?: string;
  languages: LanguageSetting[];
  organizationName: string;
}

interface Resolved { address: string; locale: Locale; keyId: string; ref: string; }

async function resolveRecipient(tx: Tx, tenantId: string, recipient: Recipient): Promise<Resolved | null> {
  if (recipient.kind === 'candidate') {
    const { rows } = await tx.query('select email_enc, locale, email_bounced, status from candidates where tenant_id = $1 and id = $2', [tenantId, recipient.candidateId]);
    const row = rows[0];
    if (!row || row.status === 'Removed') return null;
    if (row.email_bounced) { log.info(`skip: address for candidate ${recipient.candidateId} bounced`); return null; }
    const address = await decryptField<string>(tx, tenantId, row.email_enc);
    if (!address) return null;
    return { address, locale: row.locale, keyId: candidateKeyId(recipient.candidateId), ref: recipient.candidateId };
  }
  if (recipient.kind === 'staff') {
    const { rows } = await tx.query("select email, language, status from users where tenant_id = $1 and id = $2", [tenantId, recipient.userId]);
    const row = rows[0];
    if (!row || row.status === 'Deactivated') return null;
    return { address: row.email, locale: row.language, keyId: `tenant:${tenantId}`, ref: recipient.userId };
  }
  return { address: recipient.address, locale: recipient.locale, keyId: recipient.keyId, ref: recipient.ref };
}

async function loadTemplate(tx: Tx, tenantId: string, key: TemplateKey, lang: Locale, languages: LanguageSetting[]): Promise<{ subject: string; body: string } | null> {
  const { rows } = await tx.query(
    'select subject, body from notification_templates where tenant_id = $1 and key = $2 and lang = $3 and active order by version desc limit 1',
    [tenantId, key, lang]
  );
  if (rows[0]) return rows[0];
  // Built-in defaults cover the organization's required languages; an
  // optional language is used only once the organization saved content for it.
  if (!requiredLanguages(languages).includes(lang)) return null;
  return DEFAULT_TEMPLATES[key]?.[lang] ?? null;
}

// Renders in the recipient's language, falling back only where that language
// is optional for the organization (§9.7, F16), encrypts the rendered message
// under the recipient's key, and records NotificationQueued.
export async function queueNotification(tx: Tx, append: Appender, params: QueueParams): Promise<string | null> {
  const recipient = await resolveRecipient(tx, params.tenantId, params.recipient);
  if (!recipient) return null;
  let lang = recipient.locale;
  let fallback: string | undefined;
  let template = await loadTemplate(tx, params.tenantId, params.templateKey, lang, params.languages);
  if (!template) {
    const required = requiredLanguages(params.languages);
    if (required.includes(lang)) {
      log.error(`template ${params.templateKey} missing in required language ${lang}`);
      return null;
    }
    const alt = required[0] ?? 'en';
    template = await loadTemplate(tx, params.tenantId, params.templateKey, alt, params.languages);
    if (!template) return null;
    fallback = `${lang}→${alt}`;
    lang = alt;
  }
  const values = { organization_name: params.organizationName, ...params.values };
  const subject = render(template.subject, values);
  const body = render(template.body, values);
  const notificationId = randomUUID();
  await append(streamIds.notification(notificationId), 'none', [{
    type: 'NotificationQueued',
    payload: {
      notificationId,
      templateKey: params.templateKey,
      lang,
      recipientKind: params.recipient.kind === 'email' ? 'email' : params.recipient.kind,
      recipientRef: recipient.ref,
      keyId: recipient.keyId,
      address: await encryptField(tx, params.tenantId, recipient.keyId, recipient.address),
      subject: await encryptField(tx, params.tenantId, recipient.keyId, subject),
      body: await encryptField(tx, params.tenantId, recipient.keyId, body),
      fallback,
      causation: params.causation.eventType,
      causationEventId: params.causation.eventId,
      processId: params.processId,
      applicationId: params.applicationId
    },
    causationId: params.causation.eventId
  }]);
  log.info(`queued ${notificationId} template=${params.templateKey} lang=${lang} kind=${params.recipient.kind}${fallback ? ` fallback=${fallback}` : ''}`);
  return notificationId;
}
