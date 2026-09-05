import { describe, it, expect } from '@jest/globals';
import { scan, sniff } from './scanner.js';

describe('upload scanner', () => {
  it('accepts a plain PDF', () => {
    expect(scan(Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'))).toBe('clean');
  });
  it('quarantines the EICAR test file', () => {
    expect(scan(Buffer.from('%PDF-1.7 X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'))).toBe('infected');
  });
  it('rejects HTML pretending to be a PDF', () => {
    expect(sniff(Buffer.from('<html><body>hi</body></html>'))).toBe('unknown');
    expect(scan(Buffer.from('<html><body>hi</body></html>'))).toBe('infected');
  });
  it('flags PDFs with embedded JavaScript', () => {
    expect(scan(Buffer.from('%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj'))).toBe('infected');
  });
});
