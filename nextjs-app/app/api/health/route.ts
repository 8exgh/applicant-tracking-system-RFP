import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { lag } from '@/lib/commands/ops';

export const dynamic = 'force-dynamic';

// Used by the Docker HEALTHCHECK and the deploy workflow (F28)
export async function GET() {
  let database: 'ok' | 'error' = 'ok';
  let projections: unknown = null;
  try {
    await getPool().query('select 1');
    projections = (await lag()).map(l => ({ projection: l.projection, lag: l.head - l.position }));
  } catch {
    database = 'error';
  }
  return NextResponse.json({ status: database === 'ok' ? 'ok' : 'degraded', database, projections, commit: process.env.GIT_COMMIT || 'dev', buildTime: process.env.BUILD_TIME || 'unknown' }, { status: database === 'ok' ? 200 : 503 });
}
