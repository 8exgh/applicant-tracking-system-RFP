import { withPlatform } from '@/lib/db/pool';
import { rebuildProjection, runProjections, projectionLag, projectors } from '@/lib/projections';

export async function catchUpProjections(): Promise<number> {
  return withPlatform(async tx => {
    await tx.query("select pg_advisory_xact_lock(hashtext('ats:commands'))");
    return runProjections(tx);
  });
}

export async function rebuild(name: string): Promise<number> {
  return withPlatform(tx => rebuildProjection(tx, name));
}

export async function lag() {
  return withPlatform(tx => projectionLag(tx));
}

export const projectionNames = projectors.map(p => p.name);
