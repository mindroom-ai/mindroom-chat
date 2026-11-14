import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_LISTED_COMMITS,
  RELEASE_CONFIG_FILE,
  latestReleaseTag,
  nextVersion,
  parseReleaseTag,
  readAutoRelease,
  releaseNotes,
} from '../../scripts/calver.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const scriptPath = path.join(repoRoot, 'scripts/calver.mjs');
const NOV_5 = new Date('2026-11-05T12:00:00Z');

const next = (tags: string[], date = NOV_5) => {
  const { year, month, n } = nextVersion(tags, date);
  return `${year}.${month}.${n}`;
};

describe('release tags', () => {
  it.each([
    ['v2026.11.0', { year: 2026, month: 11, n: 0 }],
    ['v2026.1.12', { year: 2026, month: 1, n: 12 }],
    ['v2027.12.105', { year: 2027, month: 12, n: 105 }],
  ])('reads %s', (tag, version) => {
    expect(parseReleaseTag(tag)).toEqual(version);
  });

  it.each([
    '2026.11.0',
    'v2026.011.0',
    'v2026.11.01',
    'v2026.13.0',
    'v2026.0.1',
    'v26.11.0',
    'v2026.11',
    'v2026.11.0-rc.1',
    'v4.12.6-mindroom.180',
    'v0.1.0',
  ])('does not take %s for a release', (tag) => {
    expect(parseReleaseTag(tag)).toBeUndefined();
  });

  it('orders releases by number, not by text', () => {
    expect(latestReleaseTag(['v2026.11.9', 'v2026.11.10', 'v2026.9.30', 'v4.12.6'])?.tag).toBe(
      'v2026.11.10'
    );
  });
});

describe('the next version', () => {
  it('starts the month at 0 when there is no release yet', () => {
    expect(next([])).toBe('2026.11.0');
    expect(next(['v0.1.0', 'v4.12.6-mindroom.180', 'nightly'])).toBe('2026.11.0');
  });

  it('counts on within the month of the newest release', () => {
    expect(next(['v2026.11.0'])).toBe('2026.11.1');
    expect(next(['v2026.10.4', 'v2026.11.9', 'v2026.11.10'])).toBe('2026.11.11');
  });

  it('starts again at 0 when the month rolls over', () => {
    expect(next(['v2026.10.4'])).toBe('2026.11.0');
    expect(next(['v2026.11.4'], new Date('2026-11-30T23:59:59Z'))).toBe('2026.11.5');
    expect(next(['v2026.11.4'], new Date('2026-12-01T00:00:00Z'))).toBe('2026.12.0');
  });

  it('rolls over into a new year', () => {
    expect(next(['v2026.12.7'], new Date('2027-01-01T00:00:00Z'))).toBe('2027.1.0');
  });

  it('uses the UTC month, whatever the local time zone says', () => {
    // 23:30 on November 30 in UTC-5 is already December 1 in UTC.
    expect(next(['v2026.11.4'], new Date('2026-11-30T23:30:00-05:00'))).toBe('2026.12.0');
  });

  it('never goes below a release made with a clock ahead of this one', () => {
    expect(next(['v2026.12.0'])).toBe('2026.12.1');
  });

  it('sorts every version above the 4.12.x of earlier App Store builds', () => {
    expect(Number(next([]).split('.')[0])).toBeGreaterThan(4);
  });
});

describe('release notes', () => {
  const repository = 'example/app';

  it('lists the commits since the previous release with a link to the full comparison', () => {
    expect(
      releaseNotes({
        tag: 'v2026.11.1',
        previousTag: 'v2026.11.0',
        repository,
        commits: [
          { hash: 'b'.repeat(40), subject: 'fix(threads): the second change' },
          { hash: 'a'.repeat(40), subject: 'feat(rooms): the first change' },
        ],
      })
    ).toBe(
      [
        'Changes since v2026.11.0:',
        '',
        '- fix(threads): the second change (bbbbbbb)',
        '- feat(rooms): the first change (aaaaaaa)',
        '',
        '**Full Changelog**: https://github.com/example/app/compare/v2026.11.0...v2026.11.1',
        '',
      ].join('\n')
    );
  });

  it('notifies nobody and keeps words that look like HTML', () => {
    const notes = releaseNotes({
      tag: 'v2026.11.1',
      previousTag: 'v2026.11.0',
      repository,
      commits: [
        { hash: 'c'.repeat(40), subject: 'test(e2e): a project for the @webkit tests' },
        { hash: 'd'.repeat(40), subject: 'build: @capacitor/ios 8.5.2, mail me@example.com' },
        { hash: 'e'.repeat(40), subject: 'fix: `@types/node` and the <canvas> element' },
        { hash: 'f'.repeat(40), subject: 'fix(rtl): Matrix IDs keep their @ first' },
      ],
    });
    expect(notes).toContain('- test(e2e): a project for the `@webkit` tests (ccccccc)');
    expect(notes).toContain('- build: `@capacitor/ios` 8.5.2, mail me@example.com (ddddddd)');
    expect(notes).toContain('- fix: `@types/node` and the &lt;canvas> element (eeeeeee)');
    expect(notes).toContain('- fix(rtl): Matrix IDs keep their @ first (fffffff)');
  });

  it('counts the commits past the listed ones', () => {
    const commits = Array.from({ length: MAX_LISTED_COMMITS + 3 }, (_value, index) => ({
      hash: index.toString(16).padStart(40, '0'),
      subject: `change ${index}`,
    }));
    const notes = releaseNotes({
      tag: 'v2026.11.1',
      previousTag: 'v2026.11.0',
      repository,
      commits,
    });
    expect(notes.split('\n').filter((line) => line.startsWith('- change '))).toHaveLength(
      MAX_LISTED_COMMITS
    );
    expect(notes).toContain('- and 3 more commits');
  });

  it('counts the commits of the first release instead of listing them', () => {
    expect(
      releaseNotes({
        tag: 'v2026.11.0',
        previousTag: undefined,
        repository,
        commits: [{ hash: 'a'.repeat(40), subject: 'the only change' }],
      })
    ).toBe(
      [
        'The first release with calendar versions (vYYYY.M.N): 1 commits.',
        '',
        '**Full Changelog**: https://github.com/example/app/commits/v2026.11.0',
        '',
      ].join('\n')
    );
  });
});

describe('release.config.json', () => {
  it('holds the autoRelease switch as a boolean', () => {
    expect(
      typeof readAutoRelease(readFileSync(path.join(repoRoot, RELEASE_CONFIG_FILE), 'utf8'))
    ).toBe('boolean');
  });

  it.each(['{}', '{"autoRelease": "true"}', '{"autoRelease": 1}', 'null'])('refuses %s', (text) => {
    expect(() => readAutoRelease(text)).toThrow('must set "autoRelease" to true or false');
  });
});

// The script against a throwaway repository, with a stand-in `gh` that records each call and the
// notes it was given instead of reaching GitHub: the same commands `just release` and
// .github/workflows/release.yml run.
describe('calver.mjs in a repository', () => {
  const directories: string[] = [];
  afterEach(() => {
    directories
      .splice(0)
      .forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  });

  const setup = (autoRelease: boolean) => {
    const root = mkdtempSync(path.join(tmpdir(), 'mindroom-calver-'));
    directories.push(root);
    const repository = path.join(root, 'repository');
    const bin = path.join(root, 'bin');
    const calls = path.join(root, 'gh-calls.jsonl');
    // As in GitHub Actions; set here so a run under Actions never writes the job's own outputs.
    const outputs = path.join(root, 'github-output');
    mkdirSync(repository);
    mkdirSync(bin);
    writeFileSync(calls, '');
    writeFileSync(outputs, '');
    writeFileSync(
      path.join(bin, 'gh'),
      [
        `#!${process.execPath}`,
        "const fs = require('node:fs');",
        "const notes = fs.readFileSync(0, 'utf8');",
        'fs.appendFileSync(process.env.GH_CALLS, JSON.stringify({ args: process.argv.slice(2), notes }) + "\\n");',
      ].join('\n')
    );
    chmodSync(path.join(bin, 'gh'), 0o755);

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
        { cwd: repository, encoding: 'utf8' }
      ).trim();
    const commit = (subject: string) => {
      git('commit', '--quiet', '--allow-empty', '-m', subject);
      return git('rev-parse', 'HEAD');
    };
    git('init', '--quiet', '--initial-branch=main');
    writeFileSync(
      path.join(repository, RELEASE_CONFIG_FILE),
      `${JSON.stringify({ autoRelease }, null, 2)}\n`
    );
    git('add', RELEASE_CONFIG_FILE);
    git('commit', '--quiet', '-m', 'chore: release switch');

    const run = (...args: string[]) =>
      spawnSync(process.execPath, [scriptPath, ...args], {
        cwd: repository,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
          GH_CALLS: calls,
          GITHUB_OUTPUT: outputs,
          GITHUB_REPOSITORY: 'example/app',
        },
      });
    const ghCalls = () =>
      readFileSync(calls, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { args: string[]; notes: string });

    const githubOutput = () => readFileSync(outputs, 'utf8');

    return { git, commit, run, ghCalls, githubOutput };
  };

  it('prints the next tag from the tags of the checkout', () => {
    const { git, run } = setup(false);
    git('tag', 'v2026.11.2');

    const result = run('next', '--date', '2026-11-05');
    expect(result.stdout).toBe('v2026.11.3\n');
    expect(result.status).toBe(0);
  });

  it('prints the newest release tag of the checkout, and no tag of another form', () => {
    const { git, run } = setup(false);
    git('tag', 'v2026.11.9');
    git('tag', 'v2026.11.10');
    git('tag', 'v2026.11.10-hotfix');
    git('tag', 'vnext');

    const result = run('latest');
    expect(result.stdout).toBe('v2026.11.10\n');
    expect(result.status).toBe(0);
  });

  it('does nothing but say so while automatic releases are off', () => {
    const { commit, run, ghCalls, githubOutput } = setup(false);
    const sha = commit('feat: a change');

    const result = run('auto', sha, '--main', 'main', '--date', '2026-11-05');
    expect(result.stdout).toBe(
      'Automatic releases are off: release.config.json has "autoRelease": false. Nothing to do.\n'
    );
    expect(result.status).toBe(0);
    expect(ghCalls()).toEqual([]);
    expect(githubOutput()).toBe('');
  });

  it('tags the commit and publishes its notes once automatic releases are on', () => {
    const { git, commit, run, ghCalls, githubOutput } = setup(true);
    git('tag', 'v2026.10.4');
    commit('test(e2e): a project for the @webkit tests');
    const sha = commit('fix(threads): the filter keeps its place');

    const result = run('auto', sha, '--main', 'main', '--date', '2026-11-05');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `Release v2026.11.0 of example/app at ${sha.slice(
        0,
        7
      )} (fix(threads): the filter keeps its place)`
    );
    expect(ghCalls()).toEqual([
      {
        args: [
          'release',
          'create',
          'v2026.11.0',
          '--repo',
          'example/app',
          '--target',
          sha,
          '--title',
          'v2026.11.0',
          '--notes-file',
          '-',
        ],
        notes: expect.stringContaining('Changes since v2026.10.4:'),
      },
    ]);
    const notes = ghCalls()[0]?.notes ?? '';
    expect(notes).toContain('- test(e2e): a project for the `@webkit` tests (');
    expect(notes).toContain('compare/v2026.10.4...v2026.11.0');
    // The Release workflow's image job publishes the image of this tag.
    expect(githubOutput()).toBe('tag=v2026.11.0\n');
  });

  it('skips a commit that is already released', () => {
    const { git, commit, run, ghCalls } = setup(true);
    const sha = commit('feat: released');
    git('tag', 'v2026.11.0');

    const result = run('auto', sha, '--main', 'main', '--date', '2026-11-05');
    expect(result.stdout).toBe(
      `Not releasing: ${sha.slice(0, 7)} is already released as v2026.11.0.\n`
    );
    expect(result.status).toBe(0);
    expect(ghCalls()).toEqual([]);
  });

  it('skips a commit older than the latest release, as a run that lost a race would have', () => {
    const { git, commit, run, ghCalls } = setup(true);
    const older = commit('feat: older');
    commit('feat: newer');
    git('tag', 'v2026.11.0');

    const result = run('auto', older, '--main', 'main', '--date', '2026-11-05');
    expect(result.stdout).toBe(
      `Not releasing: ${older.slice(0, 7)} does not contain the latest release v2026.11.0.\n`
    );
    expect(result.status).toBe(0);
    expect(ghCalls()).toEqual([]);
  });

  it('refuses a commit that is not on main', () => {
    const { git, commit, run, ghCalls } = setup(true);
    git('checkout', '--quiet', '-b', 'side');
    const sha = commit('feat: on a side branch');

    const result = run('release', sha, '--main', 'main', '--yes', '--date', '2026-11-05');
    expect(result.stderr).toBe(`Not releasing: ${sha.slice(0, 7)} is not on main (main).\n`);
    expect(result.status).toBe(1);
    expect(ghCalls()).toEqual([]);
  });

  it('shows the plan and creates nothing in a dry run', () => {
    const { commit, run, ghCalls } = setup(false);
    const sha = commit('feat: a change');

    const result = run('release', '--main', 'main', '--dry-run', '--date', '2026-11-05');
    expect(result.stdout).toContain(`Release v2026.11.0 of example/app at ${sha.slice(0, 7)}`);
    expect(result.stdout).toContain(
      'The first release with calendar versions (vYYYY.M.N): 2 commits.'
    );
    expect(result.stdout).toMatch(/Dry run: nothing was created\.\n$/);
    expect(result.status).toBe(0);
    expect(ghCalls()).toEqual([]);
  });

  it('asks before it creates a release by hand, and creates none without an answer', () => {
    const { commit, run, ghCalls } = setup(false);
    commit('feat: a change');

    const result = run('release', '--main', 'main', '--date', '2026-11-05');
    expect(result.stderr).toBe('Not released: confirm in a terminal, or pass --yes.\n');
    expect(result.status).toBe(1);
    expect(ghCalls()).toEqual([]);
  });

  it('releases the tip of main by hand with --yes, whatever the switch says', () => {
    const { commit, run, ghCalls } = setup(false);
    const sha = commit('feat: a change');

    const result = run('release', '--main', 'main', '--yes', '--date', '2026-12-01');
    expect(result.status).toBe(0);
    expect(ghCalls().map(({ args }) => args.slice(0, 3).concat(args.slice(5, 7)))).toEqual([
      ['release', 'create', 'v2026.12.0', '--target', sha],
    ]);
  });
});
