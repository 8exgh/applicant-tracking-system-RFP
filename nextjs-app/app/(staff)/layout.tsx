import type { Metadata } from 'next';
import '../globals.css';

export const metadata: Metadata = { title: 'ATS staff', description: 'Staff application' };

// Rendered per request so the CSP nonce reaches every inline script
export const dynamic = 'force-dynamic';

export default function StaffRootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
