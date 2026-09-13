import { describe, expect, it } from 'vitest';
import { mindroomFile, resolvedDependencies } from './architectureTestUtils';

const TIMELINE_FILE = mindroomFile('threads/MindroomRoomTimeline.tsx');

const FORBIDDEN_LOW_LEVEL_DEPENDENCIES = [
  'threads/cacheStore/index.ts',
  'threads/eventRepository.ts',
  'threads/roomDeepLink.ts',
  'threads/roomPreloadTarget.ts',
  'threads/threadCacheCoverage.ts',
  'threads/threadFilterDsl.ts',
  'threads/threadOpenSdkBootstrap.ts',
  'threads/threadRenderState.ts',
  'threads/threadRoomFocus.ts',
  'threads/useThreadRenderState.ts',
] as const;

describe('MindroomRoomTimeline dependency boundary', () => {
  it('does not bypass adapters to import low-level cache or policy modules', () => {
    const dependencies = resolvedDependencies(TIMELINE_FILE);

    for (const dependency of FORBIDDEN_LOW_LEVEL_DEPENDENCIES) {
      expect(dependencies, `timeline bypasses its adapter via ${dependency}`).not.toContain(
        mindroomFile(dependency)
      );
    }
  });
});
