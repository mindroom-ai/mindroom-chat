import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const fixtures: string[] = [];
afterEach(() =>
  fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
);

const DESKTOP_ASSETS = [
  'MindRoom-Chat.dmg',
  'MindRoom-Chat-arm64-mac.zip',
  'MindRoom-Chat-x64-mac.zip',
  'MindRoom-Chat-arm64-mac.zip.blockmap',
  'MindRoom-Chat-x64-mac.zip.blockmap',
  'latest-mac.yml',
];

const LINUX_ASSETS = [
  'MindRoom-Chat-x86_64.AppImage',
  'MindRoom-Chat-amd64.deb',
  'MindRoom-Chat-arm64.AppImage',
  'MindRoom-Chat-arm64.deb',
  'latest-linux.yml',
  'latest-linux-arm64.yml',
];

const latestYml = (version: string, urlVersion = version) =>
  `version: ${version}\nfiles:\n  - url: https://github.com/mindroom-ai/mindroom-chat/releases/download/v${urlVersion}/MindRoom-Chat-arm64-mac.zip\n    sha512: aaa==\n    size: 10\n  - url: https://github.com/mindroom-ai/mindroom-chat/releases/download/v${urlVersion}/MindRoom-Chat-x64-mac.zip\n    sha512: bbb==\n    size: 12\npath: https://github.com/mindroom-ai/mindroom-chat/releases/download/v${urlVersion}/MindRoom-Chat-arm64-mac.zip\nsha512: aaa==\nreleaseDate: '2026-11-22T00:00:00.000Z'\n`;

const linuxLatestYml = (
  version: string,
  arch: 'x64' | 'arm64',
  urlVersion = version,
  blockMapSize: string | number | null = arch === 'x64' ? 128 : 132
) => {
  const file = arch === 'x64' ? 'MindRoom-Chat-x86_64.AppImage' : 'MindRoom-Chat-arm64.AppImage';
  const hash = arch === 'x64' ? 'xxx==' : 'yyy==';
  const size = arch === 'x64' ? 20 : 22;
  const url = `https://github.com/mindroom-ai/mindroom-chat/releases/download/v${urlVersion}/${file}`;
  const blockMapLine = blockMapSize === null ? '' : `\n    blockMapSize: ${blockMapSize}`;
  return `version: ${version}\nfiles:\n  - url: ${url}\n    sha512: ${hash}\n    size: ${size}${blockMapLine}\npath: ${url}\nsha512: ${hash}\nreleaseDate: '2026-11-25T00:00:00.000Z'\n`;
};

const manifestContent = (asset: string, version: string) => {
  if (asset === 'latest-mac.yml') return latestYml(version);
  if (asset === 'latest-linux.yml') return linuxLatestYml(version, 'x64');
  if (asset === 'latest-linux-arm64.yml') return linuxLatestYml(version, 'arm64');
  return 'bytes';
};

// A folder plays GitHub: github/<release>/<asset>. The real script runs against stubs of gh, curl
// and sleep that read and write it, and log each call.
const fixture = (mode: 'mac' | 'linux' = 'mac') => {
  const feedTag = mode === 'linux' ? 'linux-feed' : 'mac-feed';
  const feedAsset = mode === 'linux' ? 'latest-linux.yml' : 'latest-mac.yml';
  const cliFlag = mode === 'linux' ? '--linux' : '--desktop';
  const root = mkdtempSync(join(tmpdir(), `mindroom-${mode}-feed-test-`));
  fixtures.push(root);
  const github = join(root, 'github');
  mkdirSync(join(root, 'bin'), { recursive: true });
  mkdirSync(join(root, 'scripts'));
  mkdirSync(github);
  copyFileSync(
    resolve('scripts/macos-publish-appcast.sh'),
    join(root, 'scripts/macos-publish-appcast.sh')
  );
  const stub = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const github = process.env.TEST_GITHUB;
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify({ command, args }) + '\\n');
// The first <limit> calls of <name> answer differently.
const early = (name, limit) => {
  const file = path.join(process.env.TEST_LOG + '.' + name);
  const count = Number(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 0) + 1;
  fs.writeFileSync(file, String(count));
  return count <= Number(limit ?? 0);
};
if (command === 'curl') {
  const match = /\\/releases\\/download\\/([^/]+)\\/([^/]+)$/.exec(args[args.length - 1] || '');
  const feed = match ? path.join(github, match[1], match[2]) : '';
  if (early('curl', process.env.TEST_URL_LAGS)) process.stdout.write('old');
  else if (feed && fs.existsSync(feed)) process.stdout.write(fs.readFileSync(feed));
  else process.exit(22);
}
if (command === 'gh') {
  const [, action, release] = args;
  const folder = path.join(github, release);
  if (action === 'view') {
    if (process.env.TEST_FAIL === 'view:' + release) {
      console.error('HTTP 502: Bad Gateway');
      process.exit(1);
    }
    if (!fs.existsSync(folder)) {
      console.error('release not found');
      process.exit(1);
    }
    // What GitHub answers for --json, filtered by the script's own --jq (jq stands in for gh's).
    const flags = path.join(folder, '.flags');
    const kind = fs.existsSync(flags) ? fs.readFileSync(flags, 'utf8') : '';
    const json = JSON.stringify({
      isDraft: kind === 'draft',
      isPrerelease: kind === 'prerelease',
      assets: fs.readdirSync(folder).filter((name) => !name.startsWith('.')).map((name) => ({ name, state: 'uploaded' })),
    });
    const filter = args[args.indexOf('--jq') + 1];
    process.stdout.write(require('node:child_process').execFileSync('jq', ['-r', filter], { input: json }));
  }
  if (action === 'download') {
    const pattern = args[args.indexOf('--pattern') + 1];
    // As gh does, it never overwrites a local file.
    fs.copyFileSync(path.join(folder, pattern), path.join(args[args.indexOf('--dir') + 1], pattern), fs.constants.COPYFILE_EXCL);
  }
  if (action === 'create') {
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, '.flags'), 'prerelease');
  }
  if (action === 'upload') {
    const file = args[3];
    if (early('rejected', process.env.TEST_UPLOAD_REJECTED)) process.exit(1);
    fs.rmSync(path.join(folder, path.basename(file)), { force: true });
    if (early('upload', process.env.TEST_UPLOAD_FAILS)) process.exit(1);
    fs.copyFileSync(file, path.join(folder, path.basename(file)));
    if (early('landed', process.env.TEST_UPLOAD_LANDS_FAILING)) process.exit(1);
  }
}
`;
  ['gh', 'curl', 'sleep'].forEach((command) =>
    writeFileSync(join(root, 'bin', command), stub, { mode: 0o755 })
  );
  const log = join(root, 'commands.jsonl');
  const outputFile = join(root, 'github-output.txt');
  const release = (tag: string, assets: string[], kind = '') => {
    mkdirSync(join(github, tag));
    if (kind) writeFileSync(join(github, tag, '.flags'), kind);
    assets.forEach((asset) =>
      writeFileSync(join(github, tag, asset), manifestContent(asset, tag.slice(1)))
    );
  };
  return {
    release,
    asset: (rel: string, name: string) => join(github, rel, name),
    ready: (tag: string) => release(tag, mode === 'linux' ? LINUX_ASSETS : DESKTOP_ASSETS),
    live: (version?: string, extraAssets: string[] = []) => {
      mkdirSync(join(github, feedTag));
      writeFileSync(join(github, feedTag, '.flags'), 'prerelease');
      if (version) {
        if (mode === 'linux') {
          writeFileSync(join(github, feedTag, 'latest-linux.yml'), linuxLatestYml(version, 'x64'));
          writeFileSync(
            join(github, feedTag, 'latest-linux-arm64.yml'),
            linuxLatestYml(version, 'arm64')
          );
        } else {
          writeFileSync(join(github, feedTag, feedAsset), latestYml(version));
        }
      }
      extraAssets.forEach((name) => writeFileSync(join(github, feedTag, name), 'marker'));
    },
    liveLinux: (versions: { x64?: string; arm64?: string }, extraAssets: string[] = []) => {
      mkdirSync(join(github, feedTag));
      writeFileSync(join(github, feedTag, '.flags'), 'prerelease');
      if (versions.x64) {
        writeFileSync(
          join(github, feedTag, 'latest-linux.yml'),
          linuxLatestYml(versions.x64, 'x64')
        );
      }
      if (versions.arm64) {
        writeFileSync(
          join(github, feedTag, 'latest-linux-arm64.yml'),
          linuxLatestYml(versions.arm64, 'arm64')
        );
      }
      extraAssets.forEach((name) => writeFileSync(join(github, feedTag, name), 'marker'));
    },
    feedNow: (name = feedAsset) => {
      const file = join(github, feedTag, name);
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    },
    run: (tag: string, env: Record<string, string> = {}) => {
      const scriptArgs = [join(root, 'scripts/macos-publish-appcast.sh'), cliFlag, tag];
      const result = spawnSync('bash', scriptArgs, {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          GITHUB_REPOSITORY: 'mindroom-ai/mindroom-chat',
          GITHUB_OUTPUT: outputFile,
          GH_TOKEN: 'fixture',
          TEST_GITHUB: github,
          TEST_LOG: log,
          ...env,
        },
        encoding: 'utf8',
      });
      const commands = (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []).map(
        (line) => JSON.parse(line) as { command: string; args: string[] }
      );
      const output = existsSync(outputFile) ? readFileSync(outputFile, 'utf8').trim() : '';
      return { ...result, commands, output };
    },
    uploads: (result: { commands: { command: string; args: string[] }[] }) =>
      result.commands.filter(({ command, args }) => command === 'gh' && args[1] === 'upload')
        .length,
    uploadedAssets: (result: { commands: { command: string; args: string[] }[] }) =>
      result.commands
        .filter(({ command, args }) => command === 'gh' && args[1] === 'upload')
        .map(({ args }) => args[3]?.split('/').pop()),
  };
};

type Github = ReturnType<typeof fixture>;

it.each([
  [
    'first publish to mac-feed, on a prerelease it creates',
    undefined,
    'v2026.11.10',
    {},
    1,
    '2026.11.10',
    'published=true',
  ],
  [
    'a feed lost by a failed replacement',
    'none',
    'v2026.11.10',
    {},
    1,
    '2026.11.10',
    'published=true',
  ],
  ['newer desktop release', '2026.11.9', 'v2026.11.10', {}, 1, '2026.11.10', 'published=true'],
  ['a newer month', '2026.11.99', 'v2026.12.0', {}, 1, '2026.12.0', 'published=true'],
  [
    'older desktop run finishing last',
    '2026.11.10',
    'v2026.11.9',
    {},
    0,
    '2026.11.10',
    'published=false',
  ],
  ['repeated desktop run', '2026.11.10', 'v2026.11.10', {}, 0, '2026.11.10', 'published=false'],
  [
    'an upload that fails once',
    '2026.11.9',
    'v2026.11.10',
    { TEST_UPLOAD_FAILS: '1' },
    2,
    '2026.11.10',
    'published=true',
  ],
  [
    'a URL that lags',
    '2026.11.9',
    'v2026.11.10',
    { TEST_URL_LAGS: '3' },
    1,
    '2026.11.10',
    'published=true',
  ],
])('%s', (_name, before, tag, env, uploadCount, after, expectedOutput) => {
  const github = fixture();
  if (before !== undefined) github.live(before === 'none' ? undefined : before);
  github.ready(tag);
  const result = github.run(tag, env);
  expect(result.status, result.stderr).toBe(0);
  expect(github.uploads(result)).toBe(uploadCount);
  expect(github.feedNow()).toBe(latestYml(after));
  expect(result.output).toBe(expectedOutput);
});

it.each([
  ['missing x64 ZIP', DESKTOP_ASSETS.filter((a) => a !== 'MindRoom-Chat-x64-mac.zip'), ''],
  [
    'missing arm64 blockmap',
    DESKTOP_ASSETS.filter((a) => a !== 'MindRoom-Chat-arm64-mac.zip.blockmap'),
    '',
  ],
  ['draft release', DESKTOP_ASSETS, 'draft'],
  ['prerelease', DESKTOP_ASSETS, 'prerelease'],
])('skips without writing for %s', (_name, assets, kind) => {
  const github = fixture();
  github.live('2026.11.9');
  github.release('v2026.11.10', assets, kind);
  const result = github.run('v2026.11.10');
  expect(result.status, result.stderr).toBe(0);
  expect(github.uploads(result)).toBe(0);
  expect(github.feedNow()).toBe(latestYml('2026.11.9'));
  expect(result.output).toBe('published=false');
});

// The lagging URL runs every readback: up to 5.8 s in a full run on the M5 (3.1 s alone), so
// about three times that instead of Vitest's 5 s default.
it('checks the public URL again when the feed already has these bytes', () => {
  const github = fixture();
  github.live('2026.11.10');
  github.ready('v2026.11.10');
  const result = github.run('v2026.11.10', { TEST_URL_LAGS: '999' });
  expect(result.status).toBe(1);
  expect(github.uploads(result)).toBe(0);
}, 18_000);

it.each([
  ['at once', { TEST_UPLOAD_LANDS_FAILING: '1' }, 1],
  // The first readback finds the old feed; the second must still see the new one.
  ['after a rejected upload', { TEST_UPLOAD_REJECTED: '1', TEST_UPLOAD_LANDS_FAILING: '1' }, 2],
])('uploads no more once a failed upload turns out to have landed, %s', (_name, env, count) => {
  const github = fixture();
  github.live('2026.11.9');
  github.ready('v2026.11.10');
  const result = github.run('v2026.11.10', env);
  expect(result.status, result.stderr).toBe(0);
  expect(github.uploads(result)).toBe(count);
  expect(github.feedNow()).toBe(latestYml('2026.11.10'));
});

it.each([
  ['a tag that is not a calendar version', 'v2026.13.1', {}, () => undefined],
  ['unreadable mac-feed', 'v2026.11.10', { TEST_FAIL: 'view:mac-feed' }, () => undefined],
  [
    'latest-mac.yml URLs pointing at wrong version',
    'v2026.11.10',
    {},
    (github: Github) =>
      writeFileSync(
        github.asset('v2026.11.10', 'latest-mac.yml'),
        latestYml('2026.11.10', '2026.11.9')
      ),
  ],
  [
    'corrupt live latest-mac.yml',
    'v2026.11.10',
    {},
    (github: Github) => writeFileSync(github.asset('mac-feed', 'latest-mac.yml'), 'not yaml'),
  ],
])('fails closed without a write on %s', (_name, tag, env, spoil) => {
  const github = fixture();
  github.live('2026.11.9');
  github.ready('v2026.11.10');
  spoil(github);
  const result = github.run(tag, env);
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain('::error::');
  expect(github.uploads(result)).toBe(0);
});

// A URL that never serves the feed runs every readback: up to 7.4 s in a full run on the M5 (3.5 s
// alone), so three times that instead of Vitest's 5 s default.
it.each([
  ['every upload fails', { TEST_UPLOAD_FAILS: '9' }, 3, undefined],
  ['the URL never serves it', { TEST_URL_LAGS: '999' }, 1, '2026.11.10'],
])(
  'fails, without another write, when %s',
  (_name, env, uploadCount, after) => {
    const github = fixture();
    github.live('2026.11.9');
    github.ready('v2026.11.10');
    const result = github.run('v2026.11.10', env);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('::error::');
    expect(github.uploads(result)).toBe(uploadCount);
    expect(github.feedNow()).toBe(after === undefined ? undefined : latestYml(after));
  },
  22_000
);

it('skips writing and reports published=false when PAUSED is on mac-feed', () => {
  const github = fixture();
  github.live('2026.11.9', ['PAUSED']);
  github.ready('v2026.11.10');
  const result = github.run('v2026.11.10');
  expect(result.status, result.stderr).toBe(0);
  expect(github.uploads(result)).toBe(0);
  expect(github.feedNow()).toBe(latestYml('2026.11.9'));
  expect(result.output).toBe('published=false');
  expect(result.stdout).toContain('PAUSED asset present');
});

describe('--linux mode (linux-feed)', () => {
  it('creates linux-feed and publishes both latest-linux.yml and latest-linux-arm64.yml', () => {
    const github = fixture('linux');
    github.ready('v2026.11.10');
    const result = github.run('v2026.11.10');
    expect(result.status, result.stderr).toBe(0);
    expect(github.uploadedAssets(result)).toEqual(['latest-linux.yml', 'latest-linux-arm64.yml']);
    expect(github.feedNow('latest-linux.yml')).toBe(linuxLatestYml('2026.11.10', 'x64'));
    expect(github.feedNow('latest-linux-arm64.yml')).toBe(linuxLatestYml('2026.11.10', 'arm64'));
    expect(result.output).toBe('published=true');
  });

  it.each([
    ['missing arm64 deb', LINUX_ASSETS.filter((a) => a !== 'MindRoom-Chat-arm64.deb')],
    ['missing x86_64 AppImage', LINUX_ASSETS.filter((a) => a !== 'MindRoom-Chat-x86_64.AppImage')],
    ['missing latest-linux-arm64.yml', LINUX_ASSETS.filter((a) => a !== 'latest-linux-arm64.yml')],
  ])('skips without writing when %s', (_name, assets) => {
    const github = fixture('linux');
    github.live('2026.11.9');
    github.release('v2026.11.10', assets);
    const result = github.run('v2026.11.10');
    expect(result.status, result.stderr).toBe(0);
    expect(github.uploads(result)).toBe(0);
    expect(github.feedNow('latest-linux.yml')).toBe(linuxLatestYml('2026.11.9', 'x64'));
    expect(github.feedNow('latest-linux-arm64.yml')).toBe(linuxLatestYml('2026.11.9', 'arm64'));
    expect(result.output).toBe('published=false');
  });

  it.each([
    [
      'latest-linux.yml wrong URL version',
      (github: Github) =>
        writeFileSync(
          github.asset('v2026.11.10', 'latest-linux.yml'),
          linuxLatestYml('2026.11.10', 'x64', '2026.11.9')
        ),
    ],
    [
      'latest-linux-arm64.yml pointing at x86_64 AppImage',
      (github: Github) =>
        writeFileSync(
          github.asset('v2026.11.10', 'latest-linux-arm64.yml'),
          linuxLatestYml('2026.11.10', 'x64')
        ),
    ],
    [
      'latest-linux.yml missing blockMapSize',
      (github: Github) =>
        writeFileSync(
          github.asset('v2026.11.10', 'latest-linux.yml'),
          linuxLatestYml('2026.11.10', 'x64', '2026.11.10', null)
        ),
    ],
    [
      'latest-linux-arm64.yml zero blockMapSize',
      (github: Github) =>
        writeFileSync(
          github.asset('v2026.11.10', 'latest-linux-arm64.yml'),
          linuxLatestYml('2026.11.10', 'arm64', '2026.11.10', 0)
        ),
    ],
    [
      'latest-linux.yml non-numeric blockMapSize',
      (github: Github) =>
        writeFileSync(
          github.asset('v2026.11.10', 'latest-linux.yml'),
          linuxLatestYml('2026.11.10', 'x64', '2026.11.10', 'abc')
        ),
    ],
    [
      'corrupt live latest-linux-arm64.yml',
      (github: Github) =>
        writeFileSync(github.asset('linux-feed', 'latest-linux-arm64.yml'), 'not yaml'),
    ],
  ])('fails closed with zero uploads on %s', (_name, spoil) => {
    const github = fixture('linux');
    github.live('2026.11.9');
    github.ready('v2026.11.10');
    spoil(github);
    const result = github.run('v2026.11.10');
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('::error::');
    expect(github.uploads(result)).toBe(0);
  });

  it('skips writing when PAUSED is on linux-feed', () => {
    const github = fixture('linux');
    github.live('2026.11.9', ['PAUSED']);
    github.ready('v2026.11.10');
    const result = github.run('v2026.11.10');
    expect(result.status, result.stderr).toBe(0);
    expect(github.uploads(result)).toBe(0);
    expect(result.output).toBe('published=false');
    expect(result.stdout).toContain('PAUSED asset present');
  });

  it('does not downgrade linux-feed when an older tag runs', () => {
    const github = fixture('linux');
    github.live('2026.11.10');
    github.ready('v2026.11.9');
    const result = github.run('v2026.11.9');
    expect(result.status, result.stderr).toBe(0);
    expect(github.uploads(result)).toBe(0);
    expect(github.feedNow('latest-linux.yml')).toBe(linuxLatestYml('2026.11.10', 'x64'));
    expect(github.feedNow('latest-linux-arm64.yml')).toBe(linuxLatestYml('2026.11.10', 'arm64'));
    expect(result.output).toBe('published=false');
    expect(result.stdout).toContain('The feed stays at 2026.11.10.');
  });

  it.each([
    ['latest-linux-arm64.yml is missing', { x64: '2026.11.10' }],
    ['latest-linux-arm64.yml is still older', { x64: '2026.11.10', arm64: '2026.11.9' }],
  ])('heals a partial publish on re-run when %s', (_name, liveVersions) => {
    const github = fixture('linux');
    github.liveLinux(liveVersions);
    github.ready('v2026.11.10');
    const result = github.run('v2026.11.10');
    expect(result.status, result.stderr).toBe(0);
    expect(github.uploadedAssets(result)).toEqual(['latest-linux-arm64.yml']);
    expect(github.feedNow('latest-linux.yml')).toBe(linuxLatestYml('2026.11.10', 'x64'));
    expect(github.feedNow('latest-linux-arm64.yml')).toBe(linuxLatestYml('2026.11.10', 'arm64'));
    expect(result.output).toBe('published=true');
  });
});
