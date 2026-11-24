import { describe, expect, it } from 'vitest';
import { appFile, pathExists, resolvedDependencies } from '../../../test/architecture';

const TIMELINE_FILE = appFile('timeline/RoomTimeline.tsx');

const FORBIDDEN_LOW_LEVEL_DEPENDENCIES = [
  'event-store/cache/db/index.ts',
  'event-store/cache/eventRepository.ts',
  'routes/roomDeepLink.ts',
  'event-store/cache/threadCacheCoverage.ts',
  'event-store/threads/threadFilterDsl.ts',
  'threads/open/threadOpenSdkBootstrap.ts',
  'threads/open/threadOpenCacheController.ts',
  'threads/open/threadOpenCacheFirst.ts',
  'threads/open/threadOpenSeedController.ts',
  'threads/open/threadOpenTargetEvent.ts',
  'event-store/timeline/threadPaginationUtils.ts',
  'threads/threadRoomFocus.ts',
  'timeline/useThreadRenderState.ts',
  'event-store/sdk/threadBootstrapSdk.ts',
] as const;

describe('RoomTimeline dependency boundary', () => {
  it('composes pagination ownership without coupling its data owner to DOM or parent', () => {
    const pagination = appFile('threads/open/useThreadPagination.ts');
    const viewport = appFile('timeline/useThreadPrependViewport.ts');
    expect(pathExists(pagination)).toBe(true);
    expect(pathExists(viewport)).toBe(true);
    expect(resolvedDependencies(TIMELINE_FILE)).toContain(pagination);
    expect(resolvedDependencies(TIMELINE_FILE)).toContain(viewport);
    const dependencies = resolvedDependencies(pagination);
    for (const forbidden of [
      TIMELINE_FILE,
      viewport,
      appFile('timeline/threadBackPaginationController.ts'),
      appFile('event-store/timeline/timelineScrollUtils.ts'),
      appFile('timeline/scrollQuiescence.ts'),
    ]) {
      expect(dependencies).not.toContain(forbidden);
    }
  });
  it('does not bypass adapters to import low-level cache or policy modules', () => {
    const dependencies = resolvedDependencies(TIMELINE_FILE, { includeTypeOnly: false });

    for (const dependency of FORBIDDEN_LOW_LEVEL_DEPENDENCIES) {
      expect(pathExists(appFile(dependency)), `missing guarded owner ${dependency}`).toBe(
        true
      );
      expect(dependencies, `timeline bypasses its adapter via ${dependency}`).not.toContain(
        appFile(dependency)
      );
    }
  });
});
