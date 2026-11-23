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
import { afterEach, expect, it } from 'vitest';

const fixtures: string[] = [];
afterEach(() =>
  fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
);

/** A release's appcast.xml as scripts/macos-appcast.sh passes it on: one item of this version. */
const appcast = (version: string) =>
  `<?xml version="1.0" standalone="yes"?>\n<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0"><channel><title>MindRoom</title><item><title>${version}</title><sparkle:version>${version}</sparkle:version><enclosure url="https://example.invalid/v${version}/MindRoom-Chat.dmg" length="3" type="application/octet-stream" sparkle:edSignature="s1g="/></item></channel></rss>\n`;

const DESKTOP_ASSETS = [
  'MindRoom-Chat.dmg',
  'MindRoom-Chat-arm64-mac.zip',
  'MindRoom-Chat-x64-mac.zip',
  'MindRoom-Chat-arm64-mac.zip.blockmap',
  'MindRoom-Chat-x64-mac.zip.blockmap',
  'latest-mac.yml',
];

const latestYml = (version: string, urlVersion = version) =>
  `version: ${version}\nfiles:\n  - url: https://github.com/mindroom-ai/mindroom-chat/releases/download/v${urlVersion}/MindRoom-Chat-arm64-mac.zip\n    sha512: aaa==\n    size: 10\n  - url: https://github.com/mindroom-ai/mindroom-chat/releases/download/v${urlVersion}/MindRoom-Chat-x64-mac.zip\n    sha512: bbb==\n    size: 12\npath: https://github.com/mindroom-ai/mindroom-chat/releases/download/v${urlVersion}/MindRoom-Chat-arm64-mac.zip\nsha512: aaa==\nreleaseDate: '2026-11-22T00:00:00.000Z'\n`;

// A folder plays GitHub: github/<release>/<asset>. The real script runs against stubs of gh, curl
// and sleep that read and write it, and log each call.
const fixture = (mode: 'sparkle' | 'desktop' = 'sparkle') => {
  const feedTag = mode === 'desktop' ? 'mac-feed' : 'mac-appcast';
  const feedAsset = mode === 'desktop' ? 'latest-mac.yml' : 'appcast.xml';
  const manifest = mode === 'desktop' ? latestYml : appcast;
  const root = mkdtempSync(join(tmpdir(), 'mindroom-mac-feed-test-'));
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
      writeFileSync(
        join(github, tag, asset),
        asset === 'appcast.xml'
          ? appcast(tag.slice(1))
          : asset === 'latest-mac.yml'
          ? latestYml(tag.slice(1))
          : 'bytes'
      )
    );
  };
  return {
    release,
    asset: (rel: string, name: string) => join(github, rel, name),
    ready: (tag: string) =>
      release(tag, mode === 'desktop' ? DESKTOP_ASSETS : ['MindRoom-Chat.dmg', 'appcast.xml']),
    live: (version?: string, extraAssets: string[] = []) => {
      mkdirSync(join(github, feedTag));
      writeFileSync(join(github, feedTag, '.flags'), 'prerelease');
      if (version) writeFileSync(join(github, feedTag, feedAsset), manifest(version));
      extraAssets.forEach((name) => writeFileSync(join(github, feedTag, name), 'marker'));
    },
    feedNow: () => {
      const file = join(github, feedTag, feedAsset);
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    },
    run: (tag: string, env: Record<string, string> = {}) => {
      const scriptArgs = [
        join(root, 'scripts/macos-publish-appcast.sh'),
        ...(mode === 'desktop' ? ['--desktop'] : []),
        tag,
      ];
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
  };
};

type Github = ReturnType<typeof fixture>;

it.each([
  [
    'the first feed, on a prerelease it creates',
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
  ['a newer release', '2026.11.9', 'v2026.11.10', {}, 1, '2026.11.10', 'published=true'],
  ['a newer month', '2026.11.99', 'v2026.12.0', {}, 1, '2026.12.0', 'published=true'],
  [
    'an older release whose run finishes last',
    '2026.11.10',
    'v2026.11.9',
    {},
    0,
    '2026.11.10',
    'published=false',
  ],
  ['the same release again', '2026.11.10', 'v2026.11.10', {}, 0, '2026.11.10', 'published=false'],
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
  expect(github.feedNow()).toBe(appcast(after));
  expect(result.output).toBe(expectedOutput);
});

it('publishes a release from before the rename, whose DMG is MindRoom.dmg', () => {
  const github = fixture();
  github.live('2026.11.9');
  github.release('v2026.11.10', ['MindRoom.dmg', 'appcast.xml']);
  const result = github.run('v2026.11.10');
  expect(result.status, result.stderr).toBe(0);
  expect(github.uploads(result)).toBe(1);
  expect(github.feedNow()).toBe(appcast('2026.11.10'));
});

it.each([
  ['has no DMG yet', ['appcast.xml']],
  ['has no appcast', ['MindRoom-Chat.dmg']],
])('writes nothing for a release that %s', (_name, assets) => {
  const github = fixture();
  github.live('2026.11.9');
  github.release('v2026.11.10', assets);
  const result = github.run('v2026.11.10');
  expect(result.status).toBe(0);
  expect(github.uploads(result)).toBe(0);
  expect(result.output).toBe('published=false');
});

it.each([['draft'], ['prerelease']])('writes nothing for a %s, also with both assets', (kind) => {
  const github = fixture();
  github.live('2026.11.9');
  github.release('v2026.11.10', ['MindRoom-Chat.dmg', 'appcast.xml'], kind);
  const result = github.run('v2026.11.10');
  expect(result.status).toBe(0);
  expect(github.uploads(result)).toBe(0);
  expect(github.feedNow()).toBe(appcast('2026.11.9'));
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
  expect(github.feedNow()).toBe(appcast('2026.11.10'));
});

it.each([
  ['a tag that is not a calendar version', 'v2026.13.1', () => undefined],
  [
    'an appcast of another version than its tag',
    'v2026.11.10',
    (github: Github) =>
      writeFileSync(github.asset('v2026.11.10', 'appcast.xml'), appcast('2026.11.11')),
  ],
  [
    'a live feed whose version cannot be read',
    'v2026.11.10',
    (github: Github) => writeFileSync(github.asset('mac-appcast', 'appcast.xml'), 'not xml'),
  ],
])('fails without a write for %s', (_name, tag, spoil) => {
  const github = fixture();
  github.live('2026.11.12');
  github.ready('v2026.11.10');
  spoil(github);
  const result = github.run(tag);
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain('::error::');
  expect(github.uploads(result)).toBe(0);
});

// A URL that never serves the feed runs every readback: up to 7.4 s in a full run on the M5 (3.5 s
// alone), so three times that instead of Vitest's 5 s default.
it.each([
  ['the feed cannot be read', { TEST_FAIL: 'view:mac-appcast' }, 0, '2026.11.9'],
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
    expect(github.feedNow()).toBe(after === undefined ? undefined : appcast(after));
  },
  22_000
);

it.each([
  ['first publish to mac-feed', undefined, 'v2026.11.10', 1, '2026.11.10', 'published=true'],
  ['newer desktop release', '2026.11.9', 'v2026.11.10', 1, '2026.11.10', 'published=true'],
  [
    'older desktop run finishing last',
    '2026.11.10',
    'v2026.11.9',
    0,
    '2026.11.10',
    'published=false',
  ],
  ['repeated desktop run', '2026.11.10', 'v2026.11.10', 0, '2026.11.10', 'published=false'],
])('--desktop: %s', (_name, before, tag, uploadCount, after, expectedOutput) => {
  const github = fixture('desktop');
  if (before !== undefined) github.live(before);
  github.ready(tag);
  const result = github.run(tag);
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
])('--desktop skips without writing for %s', (_name, assets, kind) => {
  const github = fixture('desktop');
  github.live('2026.11.9');
  github.release('v2026.11.10', assets, kind);
  const result = github.run('v2026.11.10');
  expect(result.status, result.stderr).toBe(0);
  expect(github.uploads(result)).toBe(0);
  expect(github.feedNow()).toBe(latestYml('2026.11.9'));
  expect(result.output).toBe('published=false');
});

it.each([
  ['unreadable mac-feed', { TEST_FAIL: 'view:mac-feed' }, () => undefined],
  [
    'latest-mac.yml URLs pointing at wrong version',
    {},
    (github: Github) =>
      writeFileSync(
        github.asset('v2026.11.10', 'latest-mac.yml'),
        latestYml('2026.11.10', '2026.11.9')
      ),
  ],
  [
    'corrupt live latest-mac.yml',
    {},
    (github: Github) => writeFileSync(github.asset('mac-feed', 'latest-mac.yml'), 'not yaml'),
  ],
])('--desktop fails closed on %s', (_name, env, spoil) => {
  const github = fixture('desktop');
  github.live('2026.11.9');
  github.ready('v2026.11.10');
  spoil(github);
  const result = github.run('v2026.11.10', env);
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain('::error::');
  expect(github.uploads(result)).toBe(0);
});

it.each([['desktop'], ['sparkle']] as const)(
  'skips writing and reports published=false when PAUSED is on the %s feed',
  (mode) => {
    const github = fixture(mode);
    github.live('2026.11.9', ['PAUSED']);
    github.ready('v2026.11.10');
    const result = github.run('v2026.11.10');
    expect(result.status, result.stderr).toBe(0);
    expect(github.uploads(result)).toBe(0);
    expect(github.feedNow()).toBe(
      mode === 'desktop' ? latestYml('2026.11.9') : appcast('2026.11.9')
    );
    expect(result.output).toBe('published=false');
    expect(result.stdout).toContain('PAUSED asset present');
  }
);
