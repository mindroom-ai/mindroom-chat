import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  LEGACY_MAX_ANDROID_VERSION_CODE,
  MAX_PLAY_VERSION_CODE,
  resolveAndroidVersionMetadata,
} from '../../../scripts/android-ci-version.mjs';

const SCRIPT_PATH = fileURLToPath(
  new URL('../../../scripts/android-ci-version.mjs', import.meta.url)
);

describe('resolveAndroidVersionMetadata', () => {
  it.each([
    ['v2026.11.0', 26_110_000, '2026.11.0'],
    ['v2026.11.424', 26_110_424, '2026.11.424'],
    ['v2026.12.0', 26_120_000, '2026.12.0'],
    ['v2027.1.0', 27_010_000, '2027.1.0'],
  ])('maps %s to versionCode %d and versionName %s', (tag, versionCode, versionName) => {
    expect(resolveAndroidVersionMetadata(tag)).toEqual({ versionCode, versionName });
  });

  it('stays strictly monotonic across n, month, and year rollovers within Play bounds', () => {
    const tags = [
      'v2026.1.0',
      'v2026.11.0',
      'v2026.11.1',
      'v2026.11.424',
      'v2026.11.9999',
      'v2026.12.0',
      'v2026.12.9999',
      'v2027.1.0',
      'v4099.12.9999',
    ];

    let previous = LEGACY_MAX_ANDROID_VERSION_CODE;
    for (const tag of tags) {
      const { versionCode } = resolveAndroidVersionMetadata(tag);
      expect(versionCode).toBeGreaterThan(previous);
      expect(versionCode).toBeLessThanOrEqual(MAX_PLAY_VERSION_CODE);
      previous = versionCode;
    }
  });

  it.each(['v4.12.6-mindroom.299', 'v2025.12.0', 'v2026.11.10000', 'v4100.1.0', ''])(
    'rejects invalid or out-of-range tag %j',
    (tag) => {
      expect(() => resolveAndroidVersionMetadata(tag)).toThrow();
    }
  );

  it('prints GitHub Actions output lines from the CLI and fails non-zero on invalid input', () => {
    const ok = spawnSync(process.execPath, [SCRIPT_PATH, 'v2026.11.424'], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe('version_code=26110424\nversion_name=2026.11.424\n');

    const bad = spawnSync(process.execPath, [SCRIPT_PATH, 'v2025.12.0'], { encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('out of range');

    const missing = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: 'utf8' });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('Usage:');
  });
});
