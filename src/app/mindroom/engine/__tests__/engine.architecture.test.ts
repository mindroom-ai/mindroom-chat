import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CINNY-207 P3.3 architecture guards. Anchor the post-strip boundary
 * so future edits cannot silently reintroduce dual-write:
 *
 *   1. `persistThreadEventCacheSnapshot`,
 *      `persistRoomEventCacheSnapshot`, and
 *      `persistThreadCacheFromRoomEventsSnapshot` (the three write
 *      entry points on `eventRepository`) are consumed ONLY by
 *      `engine/**` modules — no rendering-side consumer. The single
 *      allowlisted non-engine file is `eventRepository.ts` itself,
 *      which is where the functions are defined.
 *   2. `roomLiveRenderController` (the render-only successor to the
 *      pre-strip `roomLiveEventController`) does not import any
 *      persist entry point and does not import `cacheStore/` (the
 *      cache-write layer). Rendering owns paint, not persistence.
 *   3. Engine modules must not import from `MindroomRoomTimeline` —
 *      the engine is a client-level singleton and must not depend on
 *      the mounted room component.
 */

// __tests__/engine.architecture.test.ts → engine/__tests__ → engine → mindroom
const thisDir = dirname(fileURLToPath(import.meta.url));
const engineRoot = dirname(thisDir); // src/app/mindroom/engine
const mindroomTreeRoot = dirname(engineRoot); // src/app/mindroom

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, out);
    } else if (st.isFile()) {
      out.push(abs);
    }
  }
  return out;
};

const isProductionSourceFile = (path: string): boolean =>
  (path.endsWith('.ts') || path.endsWith('.tsx')) &&
  !path.endsWith('.test.ts') &&
  !path.endsWith('.test.tsx') &&
  !path.endsWith('.d.ts') &&
  !path.includes(`${'/__tests__/'}`);

const engineModulePaths = () => walk(engineRoot).filter(isProductionSourceFile);
const mindroomTsFiles = () => walk(mindroomTreeRoot).filter(isProductionSourceFile);

const PERSIST_ENTRY_POINT_NAMES = [
  'persistThreadEventCacheSnapshot',
  'persistRoomEventCacheSnapshot',
  'persistThreadCacheFromRoomEventsSnapshot',
];

describe('CINNY-207 P3.3 engine boundary architecture', () => {
  it('persist entry points are consumed only by engine/** modules (allowlist: engine + eventRepository itself)', () => {
    const files = mindroomTsFiles();
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(mindroomTreeRoot, file).replace(/\\/g, '/');
      if (rel.startsWith('engine/')) continue;
      if (rel === 'threads/eventRepository.ts') continue;
      const source = readFileSync(file, 'utf8');
      for (const name of PERSIST_ENTRY_POINT_NAMES) {
        if (source.includes(name)) {
          offenders.push(`${rel}: mentions ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('roomLiveRenderController does not import any persist entry point and does not import cacheStore', () => {
    const renderControllerPath = join(mindroomTreeRoot, 'threads/roomLiveRenderController.ts');
    const source = readFileSync(renderControllerPath, 'utf8');
    for (const name of PERSIST_ENTRY_POINT_NAMES) {
      expect(source, `roomLiveRenderController must not import ${name}`).not.toContain(name);
    }
    // Any cacheStore import path (subpath or ./cacheStore) is forbidden
    // — the render-only controller must not touch the cache-write layer.
    expect(source).not.toMatch(/from ['"][^'"]*\/cacheStore['"]/);
    expect(source).not.toMatch(/from ['"]\.\/cacheStore['"]/);
    // The two pre-strip persist controllers are gone; guard against
    // reintroducing them under any name.
    expect(source).not.toContain('threadCachePersistenceController');
    expect(source).not.toContain('roomCacheLifecycleController');
  });

  it('engine modules do not import MindroomRoomTimeline', () => {
    const files = engineModulePaths();
    const offenders: string[] = [];
    // Match only actual import statements — comment/docstring references
    // to the file are fine (the write-through file header cites the
    // pre-strip controller by name).
    const importRegex = /from\s+['"][^'"]*MindroomRoomTimeline['"]/;
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (importRegex.test(source)) {
        offenders.push(relative(mindroomTreeRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
