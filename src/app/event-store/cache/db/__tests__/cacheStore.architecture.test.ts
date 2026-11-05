/**
 * ISSUE-207 P2.3 architecture guards for the CacheStore boundary.
 *
 * (a) the three legacy shim modules (roomEventCache, threadEventCache,
 *     threadSummaryCache) no longer exist as separate files;
 * (b) no source under `src/app/mindroom/**` still imports those shim
 *     paths (excluding this arch test file itself);
 * (c) render components do NOT import the cacheStore directly —
 *     MindroomRoomTimeline.tsx and render sources under mindroom/messages/**
 *     must not contain "from './cacheStore'" or a "/cacheStore" import
 *     path. The eventRepository and attachmentRepository seams are the
 *     sanctioned consumers;
 *     sessionCleanup and threadSummaryState/threadSummaryStore are the
 *     other allowed consumers (encoded here as the entire allowlist).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('./', import.meta.url));
// src/app/event-store/cache/db/__tests__ → src/app
const MINDROOM_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const THREADS_DIR = path.resolve(MINDROOM_ROOT, 'mindroom/threads');
const MESSAGES_DIR = path.resolve(MINDROOM_ROOT, 'messages');
const SELF_FILE = path.resolve(HERE, 'cacheStore.architecture.test.ts');
const ATTACHMENT_REPOSITORY_FILE = path.resolve(MINDROOM_ROOT, 'event-store/cache/attachmentRepository.ts');

const LEGACY_SHIM_PATHS = [
  path.resolve(THREADS_DIR, 'roomEventCache.ts'),
  path.resolve(THREADS_DIR, 'threadEventCache.ts'),
  path.resolve(THREADS_DIR, 'threadSummaryCache.ts'),
];

const walkSourceFiles = (rootDir: string): string[] => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        files.push(full);
      }
    }
  };
  walk(rootDir);
  return files;
};

const readSource = (file: string): string => readFileSync(file, 'utf8');

describe('CacheStore boundary architecture (ISSUE-207 P2.3)', () => {
  it('(a) does not keep the three legacy shim modules on disk', () => {
    for (const shimPath of LEGACY_SHIM_PATHS) {
      expect(
        existsSync(shimPath),
        `legacy shim still present: ${path.relative(MINDROOM_ROOT, shimPath)}`
      ).toBe(false);
    }
  });

  it('(b) no source under src/app/mindroom/** imports the deleted shim paths', () => {
    const forbiddenSuffixes = ['/roomEventCache', '/threadEventCache', '/threadSummaryCache'];

    // Exclude only this file's own documented references.
    const EXCLUDED_FILES = new Set([SELF_FILE]);
    const offenders: string[] = [];
    for (const file of walkSourceFiles(MINDROOM_ROOT)) {
      if (EXCLUDED_FILES.has(file)) continue;
      const source = readSource(file);
      for (const suffix of forbiddenSuffixes) {
        // Match: from '...roomEventCache', import('...threadEventCache'),
        // vi.mock('...threadSummaryCache'), etc.
        // Word-boundary the suffix so `cacheStore/legacyCacheDbNames` is
        // not confused with `legacyCacheDbNames/roomEventCache`.
        const pattern = new RegExp(`['"][^'"]*${suffix}['"]`);
        if (pattern.test(source)) {
          offenders.push(
            `${path.relative(MINDROOM_ROOT, file)} contains a reference to '${suffix}'`
          );
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('(c) render components do not import cacheStore directly', () => {
    // MindroomRoomTimeline.tsx: the timeline render component.
    const timelineSource = readSource(path.resolve(MINDROOM_ROOT, 'timeline/RoomTimeline.tsx'));
    expect(timelineSource).not.toContain("from './cacheStore'");
    expect(timelineSource).not.toContain('/cache/db');

    // Render sources under mindroom/messages/**. Tests may wire the store
    // directly, and attachmentRepository is the non-React transport owner.
    if (existsSync(MESSAGES_DIR)) {
      for (const file of walkSourceFiles(MESSAGES_DIR)) {
        if (/\.test\.tsx?$/.test(file) || file === ATTACHMENT_REPOSITORY_FILE) continue;
        const source = readSource(file);
        if (source.includes("from './cacheStore'") || source.includes('/cache/db')) {
          throw new Error(
            `${path.relative(
              MINDROOM_ROOT,
              file
            )} imports cacheStore directly — render components must go through the eventRepository seam`
          );
        }
      }
    }
  });

  it('(c) exactly the allowlisted modules import cacheStore', () => {
    // The eventRepository seam is the primary sanctioned consumer;
    // sessionCleanup (session logout) and threadSummaryState /
    // threadSummaryStore (summary state facade) are the other allowed
    // consumers. ISSUE-207 P3.2: the engine's gap tracker imports
    // markRoomTailDiscontinuity directly (a cacheStore-native API
    // with no rendering counterpart, so eventRepository would be a
    // gratuitous pass-through). ISSUE-207 P4.2: `mindroomSyncEngine`
    // itself is the D2 owner of Tier-1 writes and needs to stamp the
    // ledger federation flag / eviction protection registry /
    // lastOpenedTs on `noteRoomFocused`; `gapFillExecutor` is the
    // real backfill executor that persists /messages chunks and
    // clears the tail-discontinuity marker; `reconciler` owns its
    // durable bounded-scan continuation. These are engine-native
    // cache orchestrators — routing them through eventRepository
    // would be a gratuitous pass-through. Any OTHER cacheStore
    // import inside src/app/mindroom/** is a boundary violation
    // (route through eventRepository). The cacheStore module itself
    // is excluded.
    const ALLOWED_CONSUMERS = new Set(
      [
        path.resolve(MINDROOM_ROOT, 'event-store/cache/eventRepository.ts'),
        path.resolve(MINDROOM_ROOT, 'event-store/threads/threadSummaryState.ts'),
        path.resolve(MINDROOM_ROOT, 'threads/summary/threadSummaryActions.ts'),
        path.resolve(MINDROOM_ROOT, 'account/lifecycle/sessionCleanup.ts'),
        ATTACHMENT_REPOSITORY_FILE,
        path.resolve(MINDROOM_ROOT, 'event-store/engine', 'engineGapTracker.ts'),
        path.resolve(MINDROOM_ROOT, 'event-store/engine', 'gapFillExecutor.ts'),
        path.resolve(MINDROOM_ROOT, 'event-store/engine', 'deepHistoryJob.ts'),
        path.resolve(MINDROOM_ROOT, 'event-store/engine', 'syncEngine.ts'),
        path.resolve(MINDROOM_ROOT, 'event-store/engine', 'roomOffline.ts'),
        path.resolve(MINDROOM_ROOT, 'event-store/engine', 'engineWriteThrough.ts'),
        path.resolve(MINDROOM_ROOT, 'event-store/engine', 'enginePersistFacade.ts'),
        path.resolve(MINDROOM_ROOT, 'event-store/engine', 'reconciler.ts'),
        path.resolve(MINDROOM_ROOT, 'event-store/engine', 'reconcilerScan.ts'),
      ].map((absPath) => absPath)
    );

    const cacheStoreDir = path.resolve(MINDROOM_ROOT, 'event-store/cache/db');
    const offenders: string[] = [];

    for (const file of walkSourceFiles(MINDROOM_ROOT)) {
      if (file === SELF_FILE) continue;
      if (file.startsWith(`${cacheStoreDir}${path.sep}`)) continue;
      // Skip test files — the guard is about source-code coupling, not
      // test wiring (tests need direct access to mock the store).
      if (/\.test\.(shared\.)?tsx?$|[\\/](__tests__|test-utils)[\\/]/.test(file)) continue;

      const source = readSource(file);
      // Any relative import that ends in "/cacheStore" (barrel) or
      // "/cacheStore/..." (deep import into the store's internals).
      const pattern = /['"](?:\.\.?\/)+(?:[^'"]*\/)?(?:cache\/)?db(?:['"/])/;
      if (pattern.test(source) && !ALLOWED_CONSUMERS.has(file)) {
        offenders.push(path.relative(MINDROOM_ROOT, file));
      }
    }

    expect(offenders, `unexpected cacheStore consumers: ${offenders.join(', ')}`).toEqual([]);
  });
});
