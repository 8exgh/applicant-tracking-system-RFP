import nodemailer from 'nodemailer';

// Provider adapter interface (spec §9.7): SES/GC Notify adapters plug in
// here. Two ship: "log" (prints identifiers only) and "smtp" (nodemailer).
export interface OutboundEmail { id: string; to: string; subject: string; text: string; }
export interface SendResult { providerMessageId?: string; }
export interface EmailProvider { name: string; send(message: OutboundEmail): Promise<SendResult>; }

export class LogProvider implements EmailProvider {
  name = 'log';
  async send(message: OutboundEmail): Promise<SendResult> {
    // Never the body or the address (F16)
    console.log(`[email:log] would send ${message.id} (${message.subject.length} chars subject)`);
    return { providerMessageId: `log-${message.id}` };
  }
}

// Plain-text part always; a minimal accessible HTML part with lang set (F16)
export function htmlPart(text: string, lang: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const paragraphs = text.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;line-height:1.5">${paragraphs}</body></html>`;
}

export class SmtpProvider implements EmailProvider {
  name = 'smtp';
  private transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: (process.env.SMTP_PORT || '465') === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
  async send(message: OutboundEmail, lang = 'en'): Promise<SendResult> {
    const info = await this.transport.sendMail({ from: process.env.EMAIL_FROM || process.env.SMTP_USER, to: message.to, subject: message.subject, text: message.text, html: htmlPart(message.text, lang) });
    return { providerMessageId: info.messageId };
  }
}

export function providerFromEnv(): EmailProvider {
  return (process.env.EMAIL_PROVIDER || 'log') === 'smtp' ? new SmtpProvider() : new LogProvider();
}
