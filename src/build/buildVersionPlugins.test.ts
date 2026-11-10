import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBuildVersion } from '../../scripts/build-version.mjs';

// A build whose only change was its client plugins (MINDROOM_CLIENT_PLUGINS) kept its version, so
// open pages were never offered the update (src/app/config/appUpdate.ts) and kept running the old
// plugin code until someone reloaded them by hand.
const ENTRY = 'export default { messageRenderers: [] };\n';

describe('build version with client plugins', () => {
  const made: string[] = [];
  const plugin = (source: string, id = 'example') => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mindroom-build-plugin-'));
    made.push(directory);
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        version: '1.0.0',
        mindroomClientPlugin: { id, apiVersion: 1, entry: './index.js' },
      })
    );
    writeFileSync(path.join(directory, 'index.js'), source);
    return directory;
  };
  const versionWith = (...plugins: string[]) =>
    readBuildVersion({
      MINDROOM_BUILD_VERSION: 'build-7',
      MINDROOM_CLIENT_PLUGINS: plugins.join(','),
    });

  afterEach(() => {
    made.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  });

  it('keeps the version of a build without plugins', () => {
    expect(versionWith()).toBe('build-7');
  });

  it("gives another version when only a plugin's code changes", () => {
    const before = versionWith(plugin(ENTRY));
    const after = versionWith(plugin('export default { messageRenderers: [], extra: 1 };\n'));
    expect(before).toMatch(/^build-7-plugins-[0-9a-f]{16}$/);
    expect(after).toMatch(/^build-7-plugins-[0-9a-f]{16}$/);
    expect(after).not.toBe(before);
  });

  it('gives another version when the plugin set or its order changes', () => {
    const first = plugin(ENTRY, 'first');
    const second = plugin(ENTRY, 'second');
    const versions = [versionWith(first), versionWith(first, second), versionWith(second, first)];
    expect(new Set(versions).size).toBe(3);
  });

  it('gives the same version for the same plugin files in another directory, whatever its node_modules holds', () => {
    const original = plugin(ENTRY);
    const copy = plugin(ENTRY);
    mkdirSync(path.join(copy, 'node_modules', 'some-package'), { recursive: true });
    writeFileSync(path.join(copy, 'node_modules', 'some-package', 'index.js'), 'export {};\n');
    expect(versionWith(copy)).toBe(versionWith(original));
  });

  it('leaves out the app the plugin links in, also when the link leads back to the plugin', () => {
    const original = plugin(ENTRY);
    const linked = plugin(ENTRY);
    // As in a snapshot of scripts/e2e-slot.sh, whose copy of the plugin links to the snapshot.
    symlinkSync(linked, path.join(linked, '.mindroom-chat'));
    expect(versionWith(linked)).toBe(versionWith(original));
  });

  // Pages take a published version of at most 128 characters (src/app/config/appVersion.ts).
  it('keeps a long version within what pages accept, and two long versions apart', () => {
    const dir = plugin(ENTRY);
    const versionOf = (base: string) =>
      readBuildVersion({ MINDROOM_BUILD_VERSION: base, MINDROOM_CLIENT_PLUGINS: dir });
    const one = versionOf(`${'a'.repeat(127)}1`);
    const two = versionOf(`${'a'.repeat(127)}2`);
    expect(one).toMatch(/^[A-Za-z0-9._+-]{1,128}$/);
    expect(two).toMatch(/^[A-Za-z0-9._+-]{1,128}$/);
    expect(one).not.toBe(two);
  });
});
