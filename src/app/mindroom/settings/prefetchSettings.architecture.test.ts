/**
 * CINNY-207 P6.1 / D4: architecture guards for the prefetch settings
 * replacement. Enforces the four §6.4 rows added by Commit 4:
 *
 *   (a) `MindroomMessagePreloadLimitSetting.{tsx,test.ts}` are deleted.
 *   (b) src/app/mindroom recursive scan of .{ts,tsx} — the "zero
 *       allowlist" refers to LIVE CONSUMERS of the deleted policy: no
 *       source module reads `paginationLimit`, imports a `PreloadLimit`
 *       symbol, or references a `_PAGINATION_LIMIT` constant. The scan
 *       exempts:
 *         - this arch test file (recursive self-reference),
 *         - the D4 drop machinery itself, which must NAME the key it
 *           discards (`mindroomSettings.ts`, `mindroomSettingsBootstrap.ts`,
 *           `mindroomSettings.test.ts`),
 *         - negation guards elsewhere in `mindroom/**` that assert the
 *           string is not present in some other file
 *           (`RoomTimeline.architecture.test.ts`,
 *           `RoomTimeline.cache.test.ts`, `MindroomPrefetchSettings.test.ts`,
 *           `preloadSettings.ts` header),
 *         - the divergence note is recorded in Deviations §8.
 *       The Commit-3 rename of `timelinePagination.ts`'s
 *       `paginationLimit` parameter to `windowLimit` closed the last
 *       LIVE consumer; the exempt files hold only negation / drop /
 *       docstring references.
 *   (c) Positive assertions:
 *       - `settingsExtensions.tsx` imports `MindroomPrefetchSettings`.
 *       - `mindroomSettings.ts` declares `prefetchScope` and imports
 *         from `../engine/prefetchPolicy`.
 *   (d) `mindroomSettings.test.ts` is the Commit-4 rewrite (drop test,
 *       garbage-scope test, no-paginationLimit-key-after-write test,
 *       scrub test) — enforced by asserting the four test names exist
 *       in that file's source.
 *
 * D4 semantics (stored value DROPPED, never mapped to prefetchDepth) is
 * covered functionally by the `mindroomSettings.test.ts` "hydrates
 * prefetchDepth to the default even when a legacy paginationLimit is
 * present" case, not by this arch guard.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MINDROOM_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THIS_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'prefetchSettings.architecture.test.ts'
);

// See doc header (b) — these files reference the deleted symbol in
// documented, non-consumer ways: the D4 drop code (which must name the
// key it strips), the D4 tests that assert the drop, and legacy-
// negation guards elsewhere. Every entry is justified in a code
// comment at the referenced file.
const NON_CONSUMER_EXEMPTIONS = new Set([
  resolve(MINDROOM_DIR, 'settings/mindroomSettings.ts'),
  resolve(MINDROOM_DIR, 'settings/mindroomSettings.test.ts'),
  resolve(MINDROOM_DIR, 'settings/mindroomSettingsBootstrap.ts'),
  resolve(MINDROOM_DIR, 'settings/MindroomPrefetchSettings.test.ts'),
  resolve(MINDROOM_DIR, 'threads/preloadSettings.ts'),
  resolve(MINDROOM_DIR, 'threads/__tests__/RoomTimeline.architecture.test.ts'),
  resolve(MINDROOM_DIR, 'threads/__tests__/RoomTimeline.cache.test.ts'),
]);

const walkMindroomSources = (dir: string): string[] => {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = resolve(dir, entry);
    const stats = statSync(abs);
    if (stats.isDirectory()) {
      results.push(...walkMindroomSources(abs));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    results.push(abs);
  }
  return results;
};

describe('CINNY-207 P6.1 / D4 — legacy preload setting removal', () => {
  it('deletes MindroomMessagePreloadLimitSetting.tsx and its test', () => {
    expect(existsSync(resolve(MINDROOM_DIR, 'settings/MindroomMessagePreloadLimitSetting.tsx'))).toBe(
      false
    );
    expect(
      existsSync(resolve(MINDROOM_DIR, 'settings/MindroomMessagePreloadLimitSetting.test.ts'))
    ).toBe(false);
  });

  it('leaves no references to paginationLimit / PreloadLimit / PAGINATION_LIMIT anywhere under src/app/mindroom/', () => {
    // Zero allowlist. If a file legitimately needs one of these strings,
    // the choice is either to rename or to reevaluate whether the file
    // still belongs in this tree.
    const pattern = /paginationLimit|PreloadLimit|PAGINATION_LIMIT/;
    const offenders: { file: string; line: number; text: string }[] = [];
    for (const file of walkMindroomSources(MINDROOM_DIR)) {
      if (file === THIS_FILE) continue;
      if (NON_CONSUMER_EXEMPTIONS.has(file)) continue;
      const source = readFileSync(file, 'utf8');
      if (!pattern.test(source)) continue;
      source.split('\n').forEach((line, index) => {
        if (pattern.test(line)) {
          offenders.push({
            file: file.slice(MINDROOM_DIR.length + 1),
            line: index + 1,
            text: line,
          });
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('wires MindroomPrefetchSettings into the general-messages extension slot', () => {
    const settingsExtensionsSource = readFileSync(
      resolve(MINDROOM_DIR, 'settings/settingsExtensions.tsx'),
      'utf8'
    );
    expect(settingsExtensionsSource).toContain('MindroomPrefetchSettings');
    expect(settingsExtensionsSource).not.toContain('MindroomMessagePreloadLimitSetting');
  });

  it('declares prefetchScope + prefetchDepth in mindroomSettings.ts sourced from ../engine/prefetchPolicy', () => {
    const source = readFileSync(resolve(MINDROOM_DIR, 'settings/mindroomSettings.ts'), 'utf8');
    expect(source).toContain('prefetchScope');
    expect(source).toContain('prefetchDepth');
    expect(source).toContain("from '../engine/prefetchPolicy'");
  });

  it('rewrites mindroomSettings.test.ts around the D4 shape', () => {
    const source = readFileSync(
      resolve(MINDROOM_DIR, 'settings/mindroomSettings.test.ts'),
      'utf8'
    );
    // Four post-D4 case titles this arch guard pins.
    expect(source).toContain(
      'drops a stored paginationLimit value without mapping it onto prefetchDepth'
    );
    expect(source).toContain('coerces a garbage prefetchScope back to the default');
    expect(source).toContain(
      'never writes a paginationLimit key back to the settings blob after a settings update'
    );
    expect(source).toContain(
      'scrubs a legacy paginationLimit key from stored settings at module import'
    );
  });

  // CINNY-207 P7.2 audit finding #4 — the scrub-before-init guarantee
  // is enforced by module evaluation ordering, not by a top-level
  // statement in `src/index.tsx` (ES import hoisting defeats that).
  // `mindroomSettingsBootstrap.ts` therefore MUST run the scrub as a
  // module-scope side effect, AND MUST NOT import anything that
  // transitively reaches `state/settings.ts` — otherwise the atom
  // could initialize first via the same import graph.
  //
  // This test proves both properties by static inspection:
  //   1. The bootstrap module's source ends with a bare
  //      `dropLegacyMindroomSettings();` call outside of any function.
  //   2. Recursively following the bootstrap module's `import`
  //      statements (staying inside `src/`) never lands on
  //      `state/settings`.
  it('runs the scrub as a module-scope side effect and has no transitive import of state/settings.ts', () => {
    const bootstrapPath = resolve(MINDROOM_DIR, 'settings/mindroomSettingsBootstrap.ts');
    const source = readFileSync(bootstrapPath, 'utf8');
    // Property 1: the scrub is invoked outside any function scope. The
    // bootstrap file's structure (const arrow assigned to
    // `dropLegacyMindroomSettings`, followed by a bare call) means a
    // line matching `dropLegacyMindroomSettings();` at column 0 is the
    // side-effect call. A call indented inside a block would not.
    const bareCall = /^dropLegacyMindroomSettings\(\);$/m;
    expect(source).toMatch(bareCall);

    // Property 2: crawl imports recursively and assert no path
    // reaches `state/settings`. Only relative imports inside src/
    // are followed; matrix-js-sdk, jotai, node_modules, etc. are
    // skipped by the relative-import filter.
    const importRegex = /^import[^'"]*['"]([^'"]+)['"]/gm;
    const visited = new Set<string>();
    const stack = [bootstrapPath];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (visited.has(file)) continue;
      visited.add(file);
      const src = readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      // eslint-disable-next-line no-cond-assign
      while ((match = importRegex.exec(src)) !== null) {
        const spec = match[1];
        if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
        const dir = dirname(file);
        // Try each of the common extensions vite/tsc would resolve.
        const bases = [
          resolve(dir, spec),
          resolve(dir, `${spec}.ts`),
          resolve(dir, `${spec}.tsx`),
          resolve(dir, spec, 'index.ts'),
          resolve(dir, spec, 'index.tsx'),
        ];
        const resolved = bases.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
        if (!resolved) continue;
        if (visited.has(resolved)) continue;
        stack.push(resolved);
      }
    }
    const stateSettings = resolve(MINDROOM_DIR, '../state/settings.ts');
    expect(visited.has(stateSettings)).toBe(false);
  });

  it('keeps prefetchDepth OUT of paint-time cache reads (PR #72 greptile P2 pair)', () => {
    // `prefetchDepth` (default 10_000) is the BACKGROUND deep-history
    // budget. Open-time cache hydration must page by the interactive
    // constants or a deep cached room/thread materializes thousands of
    // IndexedDB records before first paint (AC1 regression).
    const hydration = readFileSync(
      resolve(MINDROOM_DIR, 'threads/roomCacheHydrationController.ts'),
      'utf8'
    );
    expect(hydration).not.toMatch(/limit:\s*prefetchDepth/);
    expect(hydration).toMatch(/limit:\s*ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE/);

    const threadOpen = readFileSync(
      resolve(MINDROOM_DIR, 'threads/threadOpenCacheController.ts'),
      'utf8'
    );
    expect(threadOpen).not.toMatch(/limit:\s*prefetchDepthRef/);
    expect(threadOpen).toMatch(/limit:\s*THREAD_BATCH_SIZE/);
  });
});
