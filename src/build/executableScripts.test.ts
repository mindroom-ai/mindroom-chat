import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A file that starts with `#!` is meant to be run by path: scripts call each other that way
// (scripts/appstore-screenshots.sh runs scripts/appstore-fixture-up.sh), Xcode Cloud runs
// ios/App/ci_scripts/, nginx's entrypoint skips docker/entrypoint.d/ scripts it cannot execute,
// and Gradle users run android/gradlew. Git keeps the executable bit in the index, so check it there.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const startsWithShebang = (path: string): boolean => {
  const descriptor = openSync(path, 'r');
  try {
    const head = Buffer.alloc(2);
    return readSync(descriptor, head, 0, 2, 0) === 2 && head.toString('latin1') === '#!';
  } finally {
    closeSync(descriptor);
  }
};

const trackedRegularFiles = (): { mode: string; path: string }[] =>
  execFileSync('git', ['-C', repoRoot, 'ls-files', '--stage', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf('\t');
      return { mode: entry.slice(0, entry.indexOf(' ')), path: entry.slice(tab + 1) };
    })
    .filter(({ mode }) => mode === '100644' || mode === '100755');

describe('executable scripts', () => {
  it('every tracked file with a #! line is executable in git', () => {
    const notExecutable = trackedRegularFiles()
      .filter(({ path }) => existsSync(join(repoRoot, path)))
      .filter(({ mode, path }) => mode !== '100755' && startsWithShebang(join(repoRoot, path)))
      .map(({ path }) => path);

    expect(notExecutable).toEqual([]);
  });

  it('the App Store, Xcode Cloud, Gradle and nginx entry points are among them', () => {
    const executable = new Set(
      trackedRegularFiles()
        .filter(({ mode }) => mode === '100755')
        .map(({ path }) => path)
    );

    expect(
      [
        'scripts/appstore-screenshots.sh',
        'scripts/appstore-fixture-up.sh',
        'scripts/e2e-matrix-up.sh',
        'scripts/ensure-e2e-account.sh',
        'ios/App/ci_scripts/ci_post_clone.sh',
        'ios/App/ci_scripts/ci_pre_xcodebuild.sh',
        'android/gradlew',
        'docker/entrypoint.d/99-runtime-config.sh',
      ].filter((path) => !executable.has(path))
    ).toEqual([]);
  });
});
