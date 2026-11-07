// @ts-check
// One copy of each package version in the bundle. npm installs a package again inside every
// dependent whose version range the hoisted copy does not satisfy, and the bundler knows modules by
// their path, so the app can bundle two copies of one version: its code twice, and module state
// (focus tracking, caches) that each copy keeps apart. The build fails on that and names the
// copies; the fix belongs in the dependencies, so that npm installs one copy.
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The installed package that holds a module: its path up to the last `node_modules/<name>`.
const PACKAGE_DIR = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//;

/**
 * Vite plugin: fails the build when the modules it keeps after tree-shaking come from two
 * directories of one package name and version. It checks at the end of the build phase: the
 * service worker build that runs once the app's bundle closes would hide a later error behind its
 * own.
 * @returns {import('vite').Plugin}
 */
export const onePackageCopyPerVersion = () => ({
  name: 'mindroom-one-package-copy-per-version',
  apply: 'build',
  buildEnd(error) {
    if (error) return;
    /** @type {Set<string>} */
    const dirs = new Set();
    for (const id of this.getModuleIds()) {
      // Virtual modules (`\0` ids) are not files of a package.
      if (id.startsWith('\0') || !this.getModuleInfo(id)?.isIncluded) continue;
      const dir = PACKAGE_DIR.exec(id)?.[1];
      if (dir) dirs.add(dir);
    }
    /** @type {Map<string, string[]>} name@version and the directories it is bundled from */
    const copies = new Map();
    for (const dir of dirs) {
      const { name, version } = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const key = `${name}@${version}`;
      copies.set(key, [...(copies.get(key) ?? []), path.relative(process.cwd(), dir)]);
    }
    const duplicates = [...copies].filter(([, list]) => list.length > 1);
    if (duplicates.length > 0)
      this.error(
        [
          'The bundle holds more than one copy of these package versions. npm puts a copy inside each dependent whose range the top-level version does not satisfy: change the dependencies in package.json so that one copy satisfies them all, or run npm ci if node_modules is older than package-lock.json.',
          ...duplicates.map(([key, list]) => `  ${key}: ${list.join(', ')}`),
        ].join('\n')
      );
  },
});
