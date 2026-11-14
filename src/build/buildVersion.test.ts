import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readReleaseVersion,
  resolveBuildVersion,
  resolveReleaseVersion,
} from '../../scripts/build-version.mjs';

describe('build version selection', () => {
  it('prefers the explicit operator override', () => {
    expect(
      resolveBuildVersion({
        MINDROOM_BUILD_VERSION: ' release-candidate ',
        GITHUB_SHA: 'a'.repeat(40),
      })
    ).toBe('release-candidate');
  });

  it('uses the GitHub commit hash when no explicit version is provided', () => {
    expect(resolveBuildVersion({ GITHUB_SHA: ` ${'d'.repeat(40)} ` }, 'c'.repeat(40))).toBe(
      'd'.repeat(40)
    );
  });

  it('rejects a branch-like GITHUB_SHA and uses the checked-out commit', () => {
    expect(resolveBuildVersion({ GITHUB_SHA: 'feature/offline-updater' }, 'c'.repeat(40))).toBe(
      'c'.repeat(40)
    );
  });

  it('returns no version when every source is unavailable', () => {
    expect(resolveBuildVersion({})).toBeUndefined();
  });
});

describe('release version selection', () => {
  it('prefers the explicit release override', () => {
    expect(
      resolveReleaseVersion(
        { MINDROOM_RELEASE_VERSION: ' v4.12.6-mindroom.181 ' },
        '4.12.6',
        'v4.12.6-mindroom.180-1-gabcdef0'
      )
    ).toBe('v4.12.6-mindroom.181');
  });

  it('uses the described release tag when no override is provided', () => {
    expect(resolveReleaseVersion({}, '4.12.6', 'v4.12.6-mindroom.180\n')).toBe(
      'v4.12.6-mindroom.180'
    );
  });

  it('falls back to the package version when no release tag is reachable', () => {
    expect(resolveReleaseVersion({ MINDROOM_RELEASE_VERSION: ' ' }, '4.12.6', undefined)).toBe(
      'v4.12.6'
    );
  });
});

describe('release version from Git', () => {
  let repository: string | undefined;

  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'tag.gpgsign=false',
        ...args,
      ],
      { cwd: repository, stdio: 'ignore' }
    );

  const createRepository = () => {
    repository = mkdtempSync(path.join(tmpdir(), 'mindroom-release-version-'));
    writeFileSync(path.join(repository, 'package.json'), '{"version":"4.12.6"}\n');
    git('init', '--quiet');
    git('add', 'package.json');
    git('commit', '--quiet', '-m', 'initial');
  };

  afterEach(() => {
    if (repository) rmSync(repository, { recursive: true, force: true });
    repository = undefined;
  });

  it('uses the release tag on the checked-out commit', () => {
    createRepository();
    git('tag', 'v2026.11.0');

    expect(readReleaseVersion({}, repository)).toBe('v2026.11.0');
  });

  it('describes commits after the latest release tag like git describe', () => {
    createRepository();
    git('tag', 'v2026.11.0');
    git('commit', '--quiet', '--allow-empty', '-m', 'next');

    expect(readReleaseVersion({}, repository)).toMatch(/^v2026\.11\.0-1-g[0-9a-f]{7,}$/);
  });

  it('ignores release tags for another base version', () => {
    createRepository();
    git('tag', 'v4.12.5-mindroom.179');

    expect(readReleaseVersion({}, repository)).toBe('v4.12.6');
  });
});
