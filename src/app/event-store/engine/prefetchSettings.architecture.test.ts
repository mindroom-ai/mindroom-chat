/**
 * ISSUE-207 P6.1 / D4: architecture guards for the prefetch settings
 * replacement.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('ISSUE-207 P6.1 / D4 prefetch settings replacement', () => {
  it('wires PrefetchSettings into the Storage & offline settings page', () => {
    const storagePageSource = readFileSync(
      resolve(APP_DIR, 'settings/pages/StorageOffline.tsx'),
      'utf8'
    );
    expect(storagePageSource).toContain('PrefetchSettings');
    expect(storagePageSource).not.toContain('MindroomMessagePreloadLimitSetting');
  });

  it('migrates explicitly at app bootstrap', () => {
    const indexSource = readFileSync(resolve(APP_DIR, '../index.tsx'), 'utf8');

    expect(indexSource).toContain('migrateLegacyIOSPushEnabled();');
    expect(indexSource).toContain('migratePrefetchSettingsStorage();');
    expect(indexSource.indexOf('migrateLegacyIOSPushEnabled();')).toBeLessThan(
      indexSource.indexOf('migratePrefetchSettingsStorage();')
    );
  });

  it('keeps prefetchDepth OUT of paint-time cache reads (PR #72 greptile P2 pair)', () => {
    // `prefetchDepth` (default 10_000) is the BACKGROUND deep-history
    // budget. Open-time cache hydration must page by the interactive
    // constants or a deep cached room/thread materializes thousands of
    // IndexedDB records before first paint (AC1 regression).
    const hydration = readFileSync(
      resolve(APP_DIR, 'timeline/roomCacheHydrationController.ts'),
      'utf8'
    );
    expect(hydration).not.toMatch(/limit:\s*prefetchDepth/);
    expect(hydration).toMatch(/limit:\s*ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE/);

    const threadOpen = readFileSync(
      resolve(APP_DIR, 'threads/open/threadOpenCacheController.ts'),
      'utf8'
    );
    expect(threadOpen).not.toMatch(/limit:\s*prefetchDepthRef/);
    expect(threadOpen).toMatch(/limit:\s*THREAD_BATCH_SIZE/);
  });
});
