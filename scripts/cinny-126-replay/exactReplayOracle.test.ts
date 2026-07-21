import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { fingerprintText, fingerprintsMatch, orderedSignalIdsMatch } from './exactReplayOracle';

describe('CINNY-126 exact replay oracle', () => {
  it('rejects deterministic wrong output and same-length hash mismatches', () => {
    const expected = fingerprintText('known expected output');
    expect(fingerprintsMatch(fingerprintText('deterministic wrong output'), expected)).toBe(false);
    expect(
      fingerprintsMatch(
        {
          length: expected.length,
          sha256: '0'.repeat(64),
        },
        expected
      )
    ).toBe(false);
  });

  it.each([
    ['missing', ['$edit-1', '$edit-2']],
    ['duplicate', ['$edit-1', '$edit-2', '$edit-2']],
    ['reordered', ['$edit-2', '$edit-1', '$edit-3']],
    ['final only', ['$edit-3']],
  ])('rejects a %s edit-signal sequence', (_case, actual) => {
    expect(orderedSignalIdsMatch(['$edit-1', '$edit-2', '$edit-3'], actual)).toBe(false);
  });

  it('accepts only the complete ordered edit-signal sequence', () => {
    const expected = ['$edit-1', '$edit-2', '$edit-3'];
    expect(orderedSignalIdsMatch(expected, [...expected])).toBe(true);
  });

  it('keeps private expectations independent of production helpers and committed source', async () => {
    const [offlineSource, oracleSource] = await Promise.all([
      readFile(new URL('./offline.ts', import.meta.url), 'utf8'),
      readFile(new URL('./exactReplayOracle.ts', import.meta.url), 'utf8'),
    ]);

    expect(offlineSource).not.toContain('getThreadMessagePreviewText');
    expect(offlineSource).not.toContain('buildThreadTagSnapshotMap');
    expect(offlineSource).not.toContain('expectedCompactCard');
    expect(offlineSource).toContain('trace.expectedFingerprints.compactCard');
    expect(offlineSource).toContain('trace.expectedFingerprints.overviewTags');
    expect(oracleSource).not.toMatch(/[a-f0-9]{64}/);
  });
});
