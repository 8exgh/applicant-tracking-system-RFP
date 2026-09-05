import { withPlatform, withTenant } from '@/lib/db/pool';
import { resolveTenantBySlug, TenantDirectoryEntry } from '@/lib/app/context';
import { pickLang } from '@/lib/domain/lang';
import { formatDateTime } from '@/lib/i18n/format';
import { Locale, LangMap } from '@/types/shared';
import { now } from '@/lib/clock';

export interface PublicPosting {
  processId: string; slug: string; version: number; title: string; titleLang: Locale; location: string | null;
  closeAt: string | null; closeAtText: string; publishedAt: string | null; amendedAt: string | null; status: 'scheduled' | 'open' | 'closed' | 'cancelled';
  body: string; bodyLang: Locale; fallback: boolean; reference: string;
}

function toPosting(r: Record<string, any>, locale: Locale, org: TenantDirectoryEntry): PublicPosting {
  const title = pickLang(r.title as LangMap, locale);
  const body = pickLang(r.body as LangMap, locale);
  return {
    processId: r.process_id, slug: r.slug, version: r.version, title: title.text, titleLang: title.lang, location: r.location,
    closeAt: r.close_at ? new Date(r.close_at).toISOString() : null, closeAtText: r.close_at ? formatDateTime(r.close_at, locale, org.timeZone) : '',
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null, amendedAt: r.amended_at ? new Date(r.amended_at).toISOString() : null,
    status: r.status, body: body.text, bodyLang: body.lang, fallback: body.lang !== locale, reference: r.reference
  };
}

export async function organizationBySlug(slug: string): Promise<TenantDirectoryEntry | null> {
  return withPlatform(tx => resolveTenantBySlug(tx, slug));
}

// Careers page: open postings ordered by closing date; closed and scheduled are absent (F06)
export async function listOpenPostings(orgSlug: string, locale: Locale): Promise<{ org: TenantDirectoryEntry; postings: PublicPosting[] } | null> {
  const org = await organizationBySlug(orgSlug);
  if (!org) return null;
  const postings = await withTenant(org.tenantId, async tx => {
    const { rows } = await tx.query(
      `select p.*, s.reference from poster_public p join process_summary s on s.id = p.process_id
       where p.tenant_id = $1 and p.status = 'open' and (p.close_at is null or p.close_at > $2) order by p.close_at asc nulls last`,
      [org.tenantId, now()]
    );
    return rows.map(r => toPosting(r, locale, org));
  });
  return { org, postings };
}

// A closed posting remains readable at its address (F06)
export async function getPoster(orgSlug: string, posterSlug: string, locale: Locale): Promise<{ org: TenantDirectoryEntry; posting: PublicPosting } | null> {
  const org = await organizationBySlug(orgSlug);
  if (!org) return null;
  const posting = await withTenant(org.tenantId, async tx => {
    const { rows } = await tx.query('select p.*, s.reference from poster_public p join process_summary s on s.id = p.process_id where p.tenant_id = $1 and p.slug = $2', [org.tenantId, posterSlug]);
    if (!rows[0] || rows[0].status === 'scheduled') return null;
    const r = rows[0];
    if (r.status === 'open' && r.close_at && new Date(r.close_at).getTime() <= now().getTime()) r.status = 'closed';
    return toPosting(r, locale, org);
  });
  return posting ? { org, posting } : null;
}

export function feedJson(org: TenantDirectoryEntry, postings: PublicPosting[], baseUrl: string) {
  return {
    organization: org.name,
    generatedAt: now().toISOString(),
    postings: postings.map(p => ({
      id: p.processId, reference: p.reference, title: p.title, location: p.location, closesAt: p.closeAt,
      urls: { en: `${baseUrl}/en/jobs/${p.slug}`, fr: `${baseUrl}/fr/emplois/${p.slug}` }
    }))
  };
}

function escapeXml(s: string): string { return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!)); }

export function feedRss(org: TenantDirectoryEntry, postings: PublicPosting[], baseUrl: string, locale: Locale): string {
  const items = postings.map(p => `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${baseUrl}/${locale}/${locale === 'fr' ? 'emplois' : 'jobs'}/${p.slug}</link>
      <guid isPermaLink="false">${p.processId}</guid>
      <pubDate>${p.publishedAt ? new Date(p.publishedAt).toUTCString() : ''}</pubDate>
      <description>${escapeXml(`${p.location ?? ''} — ${p.closeAtText}`)}</description>
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(org.name)}</title>
    <link>${baseUrl}/${locale}/jobs</link>
    <description>${escapeXml(org.name)}</description>
    <language>${locale}-CA</language>
${items}
  </channel>
</rss>`;
}
