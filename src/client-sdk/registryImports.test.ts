import { readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, moduleDependencies, resolveRelativeModule } from '../test/architecture';

// The plugin registry imports every plugin's entry (pluginEntries.ts, which the build replaces),
// and an entry imports the SDK: an SDK module that reached the registry as it runs would close a
// cycle, whose modules Rollup can put in different chunks that run in the wrong order.
const SDK = resolve(REPO_ROOT, 'src/client-sdk');
const REGISTRY = ['registry.ts', 'pluginEntries.ts'].map((name) =>
  resolve(REPO_ROOT, 'src/app/plugins', name)
);

/** The modules `file` loads as it runs: its imports and re-exports, but no type-only ones or `import()`. */
const runtimeImports = (file: string): string[] =>
  moduleDependencies(file)
    .filter(({ kind, typeOnly }) => (kind === 'import' || kind === 'export') && !typeOnly)
    .flatMap(({ specifier }) => resolveRelativeModule(file, specifier) ?? [])
    .filter((path) => /\.[jt]sx?$/.test(path));

/** The chain of runtime imports from `start` to the registry or the plugin entries, if any. */
const chainToRegistry = (start: string): string[] | undefined => {
  const importer = new Map<string, string | undefined>([[start, undefined]]);
  const queue = [start];
  for (const file of queue) {
    if (REGISTRY.includes(file)) {
      const chain: string[] = [];
      for (let at: string | undefined = file; at; at = importer.get(at)) {
        chain.unshift(relative(REPO_ROOT, at));
      }
      return chain;
    }
    runtimeImports(file)
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

  it.each(subpaths)('%s never loads the plugin registry or the plugin entries', (name) => {
    expect(chainToRegistry(resolve(SDK, name))).toBeUndefined();
  });
});
