import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBuildVersion } from '../../scripts/build-version.mjs';

// A checkout without Git or provider variables (an archive, a container build that leaves .git
// out) built with no version, so version.json said null and an open page never learned of a
// deployment (src/app/config/appUpdate.ts). It gets a version from the files it is built from.
describe('build version of a checkout without Git', () => {
  const made: string[] = [];
  const checkout = (source: string) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mindroom-build-source-'));
    made.push(directory);
    mkdirSync(path.join(directory, 'src'));
    writeFileSync(path.join(directory, 'index.html'), '<div id="root"></div>\n');
    writeFileSync(path.join(directory, 'package-lock.json'), '{"lockfileVersion":3}\n');
    writeFileSync(path.join(directory, 'src', 'main.ts'), source);
    return directory;
  };

  afterEach(() => {
    made.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  });

  it('names the build after its sources: the same files, the same version', () => {
    const first = checkout('export const answer = 1;\n');
    const copy = mkdtempSync(path.join(tmpdir(), 'mindroom-build-source-'));
    made.push(copy);
    cpSync(first, copy, { recursive: true });

    const version = readBuildVersion({}, first);
    expect(version).toMatch(/^source-[0-9a-f]{16}$/);
    expect(readBuildVersion({}, copy)).toBe(version);
  });

  it('gives another version when a source file changes', () => {
    const before = readBuildVersion({}, checkout('export const answer = 1;\n'));
    const after = readBuildVersion({}, checkout('export const answer = 2;\n'));
    expect(after).toMatch(/^source-/);
    expect(after).not.toBe(before);
  });

  it('still takes an explicit version first', () => {
    expect(readBuildVersion({ MINDROOM_BUILD_VERSION: 'build-7' }, checkout('x\n'))).toBe('build-7');
  });
});
