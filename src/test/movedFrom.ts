import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './architecture';

/**
 * Where the files that sat under `oldFolder` (a repository path ending in `/`) are now, as
 * absolute paths. docs/provenance/moves.tsv carries each file through its moves in order and
 * drops the deleted ones, so an architecture check written for one folder of the old layout keeps
 * its scope after the files of that folder moved apart.
 */
export const filesMovedFrom = (oldFolder: string): string[] => {
  const origins = new Map<string, string>(); // current path -> path before its first move
  const rows = readFileSync(resolve(REPO_ROOT, 'docs/provenance/moves.tsv'), 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean);
  for (const row of rows) {
    const [from = '', to = ''] = row.split('\t');
    const origin = origins.get(from) ?? from;
    origins.delete(from);
    if (to) origins.set(to, origin);
  }
  return [...origins]
    .filter(([, origin]) => origin.startsWith(oldFolder))
    .map(([current]) => resolve(REPO_ROOT, current));
};
