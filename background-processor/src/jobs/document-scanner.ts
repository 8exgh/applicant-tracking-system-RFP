import { query, queryBytes, command } from '../utils/api-client.js';
import { scan } from '../utils/scanner.js';

interface Pending { tenantId: string; applicationId: string; documentId: string; }

export async function runDocumentScanner(): Promise<number> {
  const pending = await query<Pending[]>('documents-to-scan');
  for (const d of pending) {
    let result: 'clean' | 'infected' | 'error' = 'error';
    try {
      const bytes = await queryBytes('document-bytes', { tenantId: d.tenantId, documentId: d.documentId });
      result = scan(bytes);
    } catch (err: any) {
      console.error(`[scanner] read failed for ${d.documentId}: ${err?.message ?? err}`);
    }
    await command('record-document-scanned', { tenantId: d.tenantId, applicationId: d.applicationId, documentId: d.documentId, result });
    console.log(`[scanner] ${d.documentId}: ${result}`);
  }
  return pending.length;
}
