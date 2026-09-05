import { LangMap, LanguageSetting, Locale, LOCALES } from '@/types/shared';

export function requiredLanguages(languages: LanguageSetting[]): Locale[] {
  return languages.filter(l => l.required).map(l => l.code);
}

export function enabledLanguages(languages: LanguageSetting[]): Locale[] {
  return languages.map(l => l.code);
}

// Lists the required languages a content map is missing ("fr: poster body")
export function missingLanguages(content: LangMap | undefined, languages: LanguageSetting[], label: string): string[] {
  return requiredLanguages(languages)
    .filter(code => !content || !content[code] || !content[code]!.trim())
    .map(code => `${code}: ${label}`);
}

export function pickLang(content: LangMap | undefined, locale: Locale): { text: string; lang: Locale } {
  if (!content) return { text: '', lang: locale };
  if (content[locale] && content[locale]!.trim()) return { text: content[locale]!, lang: locale };
  for (const l of LOCALES) if (content[l] && content[l]!.trim()) return { text: content[l]!, lang: l };
  return { text: '', lang: locale };
}

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'fr';
}

export function slugify(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'process';
}
