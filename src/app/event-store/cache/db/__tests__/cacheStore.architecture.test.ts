/**
 * ISSUE-207 P2.3 architecture guards for the CacheStore boundary.
 *
 * (c) render components do NOT import the cacheStore directly —
 *     RoomTimeline.tsx and render sources under messages/**
 *     must not contain a "/cache/db" import
 *     path. The eventRepository and attachmentRepository seams are the
 *     sanctioned consumers;
 *     sessionCleanup and threadSummaryState/threadSummaryActions are the
 *     other allowed consumers (encoded here as the entire allowlist).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('./', import.meta.url));
// src/app/event-store/cache/db/__tests__ → src/app
const MINDROOM_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const MESSAGES_DIR = path.resolve(MINDROOM_ROOT, 'messages');
const SELF_FILE = path.resolve(HERE, 'cacheStore.architecture.test.ts');
const ATTACHMENT_REPOSITORY_FILE = path.resolve(MINDROOM_ROOT, 'event-store/cache/attachmentRepository.ts');

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
  it('(c) render components do not import cacheStore directly', () => {
    // RoomTimeline.tsx: the timeline render component.
    const timelineSource = readSource(path.resolve(MINDROOM_ROOT, 'timeline/RoomTimeline.tsx'));
    expect(timelineSource).not.toContain('/cache/db');

    // Render sources under messages/**. Tests may wire the store
    // directly, and attachmentRepository is the non-React transport owner.
    for (const file of walkSourceFiles(MESSAGES_DIR)) {
      if (/\.test\.tsx?$/.test(file) || file === ATTACHMENT_REPOSITORY_FILE) continue;
      const source = readSource(file);
      if (source.includes('/cache/db')) {
        throw new Error(
          `${path.relative(
            MINDROOM_ROOT,
            file
          )} imports cacheStore directly — render components must go through the eventRepository seam`
        );
      }
    }
  });

  it('(c) exactly the allowlisted modules import cacheStore', () => {
    // The eventRepository seam is the primary sanctioned consumer;
    // sessionCleanup (session logout) and threadSummaryState /
    // threadSummaryActions (thread summaries) are the other allowed
    // consumers. ISSUE-207 P3.2: the engine's gap tracker imports
    // markRoomTailDiscontinuity directly (a cacheStore-native API
    // with no rendering counterpart, so eventRepository would be a
    // gratuitous pass-through). ISSUE-207 P4.2: `syncEngine`
    // itself is the D2 owner of Tier-1 writes and needs to stamp the
    // ledger federation flag / eviction protection registry /
    // lastOpenedTs on `noteRoomFocused`; `gapFillExecutor` is the
    // real backfill executor that persists /messages chunks and
    // clears the tail-discontinuity marker; `reconciler` owns its
    // durable bounded-scan continuation. These are engine-native
    // cache orchestrators — routing them through eventRepository
    // would be a gratuitous pass-through. Any OTHER cacheStore
    // import inside src/app/** is a boundary violation
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
