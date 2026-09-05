// Upload scanning (F07). ClamAV is the production target; this scanner
// implements the same contract: EICAR detection, embedded script/macro
// heuristics, and content-type sniffing so a "fake.pdf" cannot pass.
export type ScanResult = 'clean' | 'infected' | 'error';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export function sniff(buffer: Buffer): 'pdf' | 'docx' | 'doc' | 'unknown' {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return 'docx';
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return 'doc';
  return 'unknown';
}

export function scan(buffer: Buffer): ScanResult {
  if (buffer.length === 0) return 'error';
  const head = buffer.subarray(0, 4096).toString('latin1');
  if (head.includes(EICAR)) return 'infected';
  const kind = sniff(buffer);
  if (kind === 'unknown') return 'infected';
  if (kind === 'pdf') {
    const text = buffer.toString('latin1');
    if (/\/JavaScript|\/JS\b|\/Launch|\/OpenAction\s*<<[^>]*\/JS/.test(text)) return 'infected';
  }
  if (kind === 'docx') {
    const text = buffer.toString('latin1');
    if (text.includes('vbaProject.bin')) return 'infected';
  }
  return 'clean';
}
