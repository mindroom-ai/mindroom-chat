// Run with `node --test scripts/provenance-paths.test.mjs` (the `strict` recipe does).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const { lanePPaths, seamPaths } = createRequire(import.meta.url)('./provenance-paths.cjs');

const root = mkdtempSync(path.join(tmpdir(), 'provenance-paths-'));
after(() => rmSync(root, { recursive: true, force: true }));
const prov = path.join(root, 'docs', 'provenance');
mkdirSync(prov, { recursive: true });
writeFileSync(path.join(prov, 'portable.tsv'), 'src/a.ts\t10\t0\nsrc/b.ts\t5\t0\nsrc/c.ts\t3\t0\n');
writeFileSync(path.join(prov, 'portable-wave2.tsv'), 'ios/x.swift\t4\t0\n');
writeFileSync(path.join(prov, 'seams.tsv'), 'src/seam.ts\t2\tbas=0%\tnames\n');

test('without moves every listed path is its own current path', () => {
  assert.deepEqual([...lanePPaths(root)].sort(), [
    ['ios/x.swift', 'ios/x.swift'],
    ['src/a.ts', 'src/a.ts'],
    ['src/b.ts', 'src/b.ts'],
    ['src/c.ts', 'src/c.ts'],
  ]);
});

test('follows moves in order, through several batches, and drops deleted files', () => {
  writeFileSync(
    path.join(prov, 'moves.tsv'),
    [
      'old\tnew\tbatch',
      'src/a.ts\tsrc/features/a.ts\tR1',
      'src/c.ts\t\tR1',
      'src/seam.ts\tsrc/hooks/seam.ts\tR1',
      // A later batch moves a file again, and a Lane C file into the place a Lane P file left.
      'src/features/a.ts\tsrc/timeline/a.ts\tR2',
      'src/new.ts\tsrc/a.ts\tR2',
      '',
    ].join('\n')
  );
  const laneP = lanePPaths(root);
  assert.equal(laneP.get('src/timeline/a.ts'), 'src/a.ts');
  assert.equal(laneP.get('src/b.ts'), 'src/b.ts');
  assert.ok(!laneP.has('src/a.ts'), 'the Lane C file that took the old path stays Lane C');
  assert.ok(!laneP.has('src/c.ts'), 'deleted files leave the list');
  assert.equal(lanePPaths(root, ['portable-wave2.tsv']).size, 1, 'a list can be chosen');
  assert.deepEqual([...seamPaths(root)], [['src/hooks/seam.ts', 'src/seam.ts']]);
});
