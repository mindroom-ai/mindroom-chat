import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, moduleDependencies, resolveRelativeModule } from '../test/architecture';

// The plugin registry imports every plugin's entry (pluginEntries.ts, which the build replaces),
// and an entry imports the SDK: an SDK module whose static imports reached the registry would close
// a cycle, whose modules Rollup can put in different chunks that run in the wrong order.
// And `room`, which plugin entries bind as the app starts, loads `ThreadView`'s timeline and
// composer only when a thread view first renders.
const SDK = resolve(REPO_ROOT, 'src/client-sdk');
const REGISTRY = ['registry.ts', 'pluginEntries.ts'].map((name) =>
  resolve(REPO_ROOT, 'src/app/plugins', name)
);

/**
 * The modules `file` imports statically: its imports and re-exports, but no type-only ones, which
 * the build drops, or `import()`.
 */
const staticImports = (file: string): string[] =>
  moduleDependencies(file)
    .filter(({ kind, typeOnly }) => (kind === 'import' || kind === 'export') && !typeOnly)
    .flatMap(({ specifier }) => resolveRelativeModule(file, specifier) ?? [])
    .filter((path) => /\.[jt]sx?$/.test(path));

/** The chain of static imports from `start` to one of `targets`, if any. */
const chainTo = (start: string, targets: readonly string[]): string[] | undefined => {
  const importer = new Map<string, string | undefined>([[start, undefined]]);
  const queue = [start];
  for (const file of queue) {
    if (targets.includes(file)) {
      const chain: string[] = [];
      for (let at: string | undefined = file; at; at = importer.get(at)) {
        chain.unshift(relative(REPO_ROOT, at));
      }
      return chain;
    }
    staticImports(file)
      .filter((next) => !importer.has(next))
      .forEach((next) => {
        importer.set(next, file);
        queue.push(next);
      });
  }
  return undefined;
};

describe('the client SDK subpaths', () => {
  const subpaths = readdirSync(SDK).filter((name) => /^\w+\.ts$/.test(name));

  it.each(subpaths)(
    '%s has no static import chain to the plugin registry or the plugin entries',
    (name) => {
      expect(chainTo(resolve(SDK, name), REGISTRY)).toBeUndefined();
    }
  );

  it('room has no static import chain to the thread view, its timeline or its composer', () => {
    const threadView = [
      'room/ThreadView.tsx',
      'timeline/RoomTimeline.tsx',
      'composer/RoomInput.tsx',
    ];
    expect(
      chainTo(
        resolve(SDK, 'room.ts'),
        threadView.map((path) => resolve(REPO_ROOT, 'src/app', path))
      )
    ).toBeUndefined();
  });
});
