import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
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

  // CINNY-207 P5.1 Commit 2: `/relations` fetch boundary. The
  // engine-owned `fetchAllThreadRelations` helper is the ONLY page-
  // through-relations fetcher; the `mx.fetchRelations` boundary is
  // reserved for the two limit-50 fallback SDK bootstraps in
  // threadOpenSdkBootstrap.ts (documented allowlist below).
  it('fetchAllThreadRelations is defined in engine/, and imported only within engine/**', () => {
    const files = mindroomTsFiles();
    const definers: string[] = [];
    const nonEngineImporters: string[] = [];
    for (const file of files) {
      const rel = relative(mindroomTreeRoot, file).replace(/\\/g, '/');
      const source = readFileSync(file, 'utf8');
      if (source.includes('export async function fetchAllThreadRelations')) {
        definers.push(rel);
      }
      // `re-export` from `threadBootstrap.ts` is allowed for tests
      // that still import from that facade; it's the ONE non-engine
      // file allowed to reference the symbol.
      const isReExport =
        rel === 'threads/threadBootstrap.ts' &&
        source.includes("from '../engine/threadRelationsFetcher'");
      if (rel.startsWith('engine/')) continue;
      if (isReExport) continue;
      // Only match import statements, not comments.
      if (/from\s+['"][^'"]*['"];?\s*$/m.test(source)) {
        const importsFromEngine = /import\s+\{[^}]*fetchAllThreadRelations[^}]*\}\s+from\s+['"][^'"]*engine['"]/.test(
          source
        );
        if (importsFromEngine) {
          nonEngineImporters.push(rel);
        }
        // Non-engine, non-re-export files that import the symbol from
        // anywhere else trip the guard too.
        const importsFromNonEngine =
          /import\s+\{[^}]*fetchAllThreadRelations[^}]*\}\s+from\s+['"](?!.*engine)/.test(source);
        if (importsFromNonEngine) {
          nonEngineImporters.push(`${rel}: imports fetchAllThreadRelations from non-engine`);
        }
      }
    }
    expect(definers).toEqual(['engine/threadRelationsFetcher.ts']);
    // CINNY-207 P5 review (greptile P1: dedup returns void):
    // `threadOverviewResumeController.ts` no longer imports
    // `fetchAllThreadRelations` directly — it now routes through
    // `enqueueThreadBackfillJob` (same as the thread-open path in
    // `threadOpenCacheController.ts`) so the shared scheduler
    // `(roomId, threadId, 'thread-backfill')` key resolves to a
    // consistent `Promise<ThreadBackfillResult>` for both callers.
    // No non-engine importers should remain.
    //
    // NOTE: `notifications/readReceipts.ts` uses `mx.fetchRelations`
    // directly with a `RelationType.Thread` limit-1 receipt probe —
    // that's receipts-domain, not thread-history backfill, and does
    // NOT import `fetchAllThreadRelations`. Excluded from this guard
    // by scope: the guard checks for `fetchAllThreadRelations`
    // specifically.
    expect(nonEngineImporters).toEqual([]);
  });

  // CINNY-207 P5.1 Commit 2: `mx.fetchRelations` file-level allowlist.
  // After Commit 2 the ONLY non-engine, non-receipts caller is
  // `threadOpenSdkBootstrap.ts`, which retains exactly TWO limit-50
  // fallback bootstraps for the SDK thread model. A third fetchRelations
  // call in that file — or any new caller anywhere else in threads/ —
  // trips this guard.
  it('mx.fetchRelations in threads/ is limited to threadOpenSdkBootstrap.ts with exactly 2 occurrences', () => {
    const threadsRoot = join(mindroomTreeRoot, 'threads');
    const files = walk(threadsRoot).filter(isProductionSourceFile);
    const perFileCounts: Record<string, number> = {};
    for (const file of files) {
      const rel = relative(mindroomTreeRoot, file).replace(/\\/g, '/');
      const source = readFileSync(file, 'utf8');
      const matches = source.match(/mx\.fetchRelations\(/g) ?? [];
      if (matches.length > 0) perFileCounts[rel] = matches.length;
    }
    // Exactly one file allowed; exactly two occurrences in that file.
    expect(perFileCounts).toEqual({
      'threads/threadOpenSdkBootstrap.ts': 2,
    });
  });
});

/**
 * Engine framework-agnostic boundary.
 *
 * The engine is domain logic layered over matrix-js-sdk. It must stay
 * React-free so it can be reasoned about — and one day lifted into a
 * standalone package — independent of Cinny's render tree. These guards
 * pin that property so a stray `useEffect` or a sideways import into the
 * render/adapter layer fails CI instead of silently coupling the engine
 * to the UI.
 *
 * The SOLE allowed React seam is `engineContext.tsx`, the thin
 * Provider/hook wrapper that hands the singleton engine to the tree.
 * The engine may still reach DOWN to pure, React-free primitives/types
 * that happen to live under `threads/` (cacheStore, cacheProbe,
 * eventRepository, eventCacheEditUtils, timelineDebug, preloadSettings,
 * types) — those are the cache layer, not the render layer. What it must
 * not do is reach SIDEWAYS into `threads/*Controller*` hooks or `.tsx`
 * components. `HydratedThreadCachePage` was moved to `threads/types.ts`
 * exactly so the reconciler stopped importing the
 * `threadOpenCacheController` hook module for its type.
 */
describe('engine framework-agnostic boundary (library-extraction guard)', () => {
  const REACT_SEAM_ALLOWLIST = ['engineContext.tsx'];

  // Strip comments first so a docstring citing a controller by name (the
  // write-through/reconciler headers do this) never registers as an
  // import. `[^:]` guard leaves `://` inside string URLs alone.
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  // Every module specifier a file depends on, across ALL forms — not a
  // single hand-rolled `import ... from` regex that a multiline import,
  // a bare `import 'x'`, an `export { y } from 'x'` re-export, a dynamic
  // `import('x')`, or a `require('x')` would slip past (greptile P2).
  const moduleSpecifiers = (source: string): string[] => {
    const clean = stripComments(source);
    const specs: string[] = [];
    const patterns = [
      /\bfrom\s*['"]([^'"]+)['"]/g, // import ... from 'x' / export ... from 'x' (multiline-safe)
      /\bimport\s+['"]([^'"]+)['"]/g, // bare side-effect: import 'x'
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('x')
      /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, // require('x')
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      // eslint-disable-next-line no-cond-assign
      while ((m = re.exec(clean)) !== null) specs.push(m[1]);
    }
    return specs;
  };

  const isReactSpecifier = (spec: string): boolean =>
    spec === 'react' ||
    spec === 'react-dom' ||
    spec.startsWith('react/') ||
    spec.startsWith('react-dom/');

  // Resolve a RELATIVE specifier to a real on-disk file so extensionless
  // imports of a `.tsx` component are caught (greptile P2: the repo's
  // extensionless style would let `../threads/SomeComponent` — a `.tsx`
  // — pass a string-only check). Non-relative (package) specs return
  // undefined; only React packages matter for those, handled above.
  const resolveRelative = (fromFile: string, spec: string): string | undefined => {
    if (!spec.startsWith('.')) return undefined;
    const base = resolve(dirname(fromFile), spec);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
    ];
    return candidates.find((c) => existsSync(c) && statSync(c).isFile());
  };

  const engineReactImporters = (): string[] => {
    const importers: string[] = [];
    for (const file of engineModulePaths()) {
      const rel = relative(engineRoot, file).replace(/\\/g, '/');
      if (moduleSpecifiers(readFileSync(file, 'utf8')).some(isReactSpecifier)) {
        importers.push(rel);
      }
    }
    return importers;
  };

  it('no engine/** module imports react except the engineContext.tsx seam', () => {
    const offenders = engineReactImporters().filter(
      (rel) => !REACT_SEAM_ALLOWLIST.includes(rel)
    );
    expect(offenders).toEqual([]);
  });

  it('engineContext.tsx is the only engine react seam (allowlist stays intentional)', () => {
    // If the engine ever legitimately needs a second React seam, add it
    // to REACT_SEAM_ALLOWLIST deliberately — do not let one appear by
    // accident. Equality (not subset) keeps the allowlist honest.
    expect(engineReactImporters()).toEqual(REACT_SEAM_ALLOWLIST);
  });

  it('no engine/** module imports a React adapter (a .tsx component or a *Controller*/*View* hook)', () => {
    // Engine may reach DOWN to pure primitives/types under threads/
    // (cacheStore, cacheProbe, eventRepository, eventCacheEditUtils,
    // timelineDebug, preloadSettings, types) — but never SIDEWAYS into
    // the render/adapter layer. We resolve each relative import to its
    // real file: a `.tsx` target is a component; a basename ending in
    // Controller/View is an adapter hook (these are `.ts` files in this
    // repo, so name — not extension — is the signal).
    const adapterName = /(?:Controller|View)$/;
    const offenders: string[] = [];
    for (const file of engineModulePaths()) {
      const rel = relative(engineRoot, file).replace(/\\/g, '/');
      for (const spec of moduleSpecifiers(readFileSync(file, 'utf8'))) {
        const resolved = resolveRelative(file, spec);
        // The barrel (index.ts) legitimately re-exports the Provider/hook
        // from the engineContext.tsx seam — allow importing that one
        // allowlisted `.tsx`, forbid every other component.
        const resolvedRel = resolved
          ? relative(engineRoot, resolved).replace(/\\/g, '/')
          : undefined;
        const isSeam = resolvedRel !== undefined && REACT_SEAM_ALLOWLIST.includes(resolvedRel);
        const specBase = basename(spec, extname(spec));
        const isTsxComponent = (resolved?.endsWith('.tsx') ?? false) && !isSeam;
        const isAdapterHook = adapterName.test(specBase);
        if (isTsxComponent || isAdapterHook) {
          offenders.push(`${rel}: imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
