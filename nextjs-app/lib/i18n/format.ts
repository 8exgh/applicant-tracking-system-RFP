import { Locale } from '@/types/shared';

// Dates render in the viewer's locale and the organization's time zone with
// its abbreviation (spec §9.8): "January 19, 2027, 11:59 PM (MST)" /
// "19 janvier 2027, 23 h 59 (HNR)".
export function formatDateTime(date: Date | string, locale: Locale, timeZone: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tag = locale === 'fr' ? 'fr-CA' : 'en-CA';
  const main = new Intl.DateTimeFormat(tag, { timeZone, year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: locale !== 'fr' }).format(d);
  const zone = new Intl.DateTimeFormat(tag, { timeZone, timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value ?? timeZone;
  return `${main} (${zone})`;
}

export function formatDate(date: Date | string, locale: Locale, timeZone: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', { timeZone, year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

export function formatCurrency(amount: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(amount);
}

export function daysBetween(a: Date | string, b: Date | string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}
