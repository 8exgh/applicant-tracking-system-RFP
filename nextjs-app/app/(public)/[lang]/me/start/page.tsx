'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { candidateApi, errorMessage } from '@/lib/ui/client-api';

// After the magic link: start (or resume) the application, then open the form
export default function Start() {
  const params = useParams<{ lang: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState('');
  useEffect(() => {
    const processId = sp.get('processId');
    if (!processId) { router.replace(`/${params.lang}/me`); return; }
    let source: unknown;
    try { source = sp.get('source') ? JSON.parse(sp.get('source')!) : undefined; } catch { source = undefined; }
    candidateApi.command('start-application', { processId, source })
      .then(r => router.replace(`/${params.lang}/me/applications/${r.applicationId}`))
      .catch(e => setError(errorMessage(e)));
  }, [params.lang, router, sp]);
  return <p role="status" aria-live="polite">{error || '…'}</p>;
}
