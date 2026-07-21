import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { EXACT_REPLAY_FINGERPRINTS, fingerprintText, fingerprintsMatch } from './exactReplayOracle';

describe('CINNY-126 exact replay oracle', () => {
  it('rejects deterministic wrong output and same-length hash mismatches', () => {
    expect(
      fingerprintsMatch(
        fingerprintText('deterministic wrong output'),
        EXACT_REPLAY_FINGERPRINTS.presentation
      )
    ).toBe(false);
    expect(
      fingerprintsMatch(
        {
          length: EXACT_REPLAY_FINGERPRINTS.compactCard.length,
          sha256: '0'.repeat(64),
        },
        EXACT_REPLAY_FINGERPRINTS.compactCard
      )
    ).toBe(false);
  });

  it('keeps expected presentation and tag values independent of production helpers', async () => {
    const offlineSource = await readFile(new URL('./offline.ts', import.meta.url), 'utf8');

    expect(offlineSource).not.toContain('getThreadMessagePreviewText');
    expect(offlineSource).not.toContain('buildThreadTagSnapshotMap');
    expect(offlineSource).not.toContain('expectedCompactCard');
    expect(offlineSource).toContain('EXACT_REPLAY_FINGERPRINTS.compactCard');
    expect(offlineSource).toContain('EXACT_REPLAY_FINGERPRINTS.overviewTags');
  });
});
