import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onePackageCopyPerVersion } from '../../scripts/package-copies.mjs';

let root = '';
beforeEach(() => {
  // Module ids are real paths, so the modules below are named by one (macOS links /var).
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'package-copies-')));
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

/**
 * Ends a build whose module graph holds these modules (id, and whether tree-shaking kept it), with
 * these client plugin directories.
 */
const endBuild = (modules: Record<string, boolean>, error?: Error, pluginDirs?: string[]) => {
  const plugin = onePackageCopyPerVersion(pluginDirs);
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

  it('leaves out the packages a client plugin installed in its own directory', () => {
    install({
      'node_modules/shared': ['shared', '1.0.0'],
      'plugins/example/node_modules/shared': ['shared', '1.0.0'],
    });
    mkdirSync(at('plugins/other'));
    const modules = {
      [at('node_modules/shared/index.js')]: true,
      [at('plugins/example/node_modules/shared/index.js')]: true,
    };
    expect(() => endBuild(modules, undefined, [at('plugins/example')])).not.toThrow();
    expect(() => endBuild(modules, undefined, [at('plugins/other')])).toThrow(/shared@1\.0\.0/);
  });
});

describe('a client plugin', () => {
  it('fails the build, naming the plugin and the package, when it bundles its own copy of a package the app shares', () => {
    // An npm alias ("jotai-copy": "npm:jotai@2.6.0") installs jotai under another name.
    install({ 'plugins/example/node_modules/jotai-copy': ['jotai', '2.6.0'] });
    const modules = { [at('plugins/example/node_modules/jotai-copy/esm/index.mjs')]: true };
    expect(() => endBuild(modules, undefined, [at('plugins/example')])).toThrow(
      `jotai: ${path.relative(
        process.cwd(),
        at('plugins/example/node_modules/jotai-copy')
      )} (client plugin ${at('plugins/example')})`
    );
  });

  it("leaves out shared packages outside the plugin's node_modules, such as the app's in a plugin directory that holds it", () => {
    install({ 'plugins/acme/client/node_modules/jotai': ['jotai', '2.6.0'] });
    const modules = { [at('plugins/acme/client/node_modules/jotai/esm/index.mjs')]: true };
    expect(() => endBuild(modules, undefined, [at('plugins/acme')])).not.toThrow();
  });
});
