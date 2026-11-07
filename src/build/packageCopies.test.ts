import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onePackageCopyPerVersion } from '../../scripts/package-copies.mjs';

let root = '';
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'package-copies-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const at = (file: string) => path.join(root, file);

/** Writes the package.json of each installed package directory: name and version. */
const install = (packages: Record<string, [name: string, version: string]>) => {
  for (const [dir, [name, version]] of Object.entries(packages)) {
    mkdirSync(at(dir), { recursive: true });
    writeFileSync(at(`${dir}/package.json`), JSON.stringify({ name, version }));
  }
};

/** Ends a build whose module graph holds these modules (id, and whether tree-shaking kept it). */
const endBuild = (modules: Record<string, boolean>, error?: Error) => {
  const plugin = onePackageCopyPerVersion();
  const buildEnd = plugin.buildEnd as unknown as (this: unknown, error?: Error) => void;
  buildEnd.call(
    {
      getModuleIds: () => Object.keys(modules).values(),
      getModuleInfo: (id: string) => ({ isIncluded: modules[id] }),
      error: (message: string) => {
        throw new Error(message);
      },
    },
    error
  );
};

describe('onePackageCopyPerVersion', () => {
  it('fails the build when one package version is bundled from two directories', () => {
    install({
      'node_modules/@x/a/node_modules/@y/shared': ['@y/shared', '1.0.0'],
      'node_modules/@x/b/node_modules/@y/shared': ['@y/shared', '1.0.0'],
    });
    expect(() =>
      endBuild({
        [at('node_modules/@x/a/node_modules/@y/shared/dist/index.mjs')]: true,
        [at('node_modules/@x/b/node_modules/@y/shared/dist/index.mjs')]: true,
      })
    ).toThrow(
      /@y\/shared@1\.0\.0: \S*@x\/a\/node_modules\/@y\/shared, \S*@x\/b\/node_modules\/@y\/shared/
    );
  });

  it('passes other versions, virtual modules and copies that tree-shaking drops', () => {
    install({
      'node_modules/shared': ['shared', '2.0.0'],
      'node_modules/a/node_modules/shared': ['shared', '1.0.0'],
      'node_modules/b/node_modules/shared': ['shared', '1.0.0'],
    });
    expect(() =>
      endBuild({
        [at('node_modules/shared/index.js')]: true,
        [at('node_modules/a/node_modules/shared/index.js')]: true,
        [at('node_modules/b/node_modules/shared/index.js')]: false,
        [`\0${at('node_modules/b/node_modules/shared/index.js')}?commonjs-proxy`]: true,
      })
    ).not.toThrow();
  });

  it('leaves a build that already failed to report its own error', () => {
    install({
      'node_modules/a/node_modules/shared': ['shared', '1.0.0'],
      'node_modules/b/node_modules/shared': ['shared', '1.0.0'],
    });
    const modules = {
      [at('node_modules/a/node_modules/shared/index.js')]: true,
      [at('node_modules/b/node_modules/shared/index.js')]: true,
    };
    expect(() => endBuild(modules, new Error('could not parse a module'))).not.toThrow();
    expect(() => endBuild(modules)).toThrow(/shared@1\.0\.0/);
  });
});
