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
  `<?xml version="1.0" standalone="yes"?>\n<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0"><channel><title>MindRoom</title><item><title>${version}</title><sparkle:version>${version}</sparkle:version><enclosure url="https://example.invalid/v${version}/MindRoom.dmg" length="3" type="application/octet-stream" sparkle:edSignature="s1g="/></item></channel></rss>\n`;

// A folder plays GitHub: github/<release>/<asset>. The real script runs against stubs of gh, curl
// and sleep that read and write it, and log each call.
const fixture = () => {
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
const feed = path.join(github, 'mac-appcast', 'appcast.xml');
if (command === 'curl') {
  if (early('curl', process.env.TEST_URL_LAGS)) process.stdout.write('old');
  else if (fs.existsSync(feed)) process.stdout.write(fs.readFileSync(feed));
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
    fs.readdirSync(folder).forEach((name) => console.log(name));
  }
  if (action === 'download') {
    fs.copyFileSync(path.join(folder, 'appcast.xml'), path.join(args[args.indexOf('--dir') + 1], 'appcast.xml'));
  }
  if (action === 'create') fs.mkdirSync(folder);
  if (action === 'upload') {
    const file = args[3];
    fs.rmSync(path.join(folder, path.basename(file)), { force: true });
    if (early('upload', process.env.TEST_UPLOAD_FAILS)) process.exit(1);
    fs.copyFileSync(file, path.join(folder, path.basename(file)));
  }
}
`;
  ['gh', 'curl', 'sleep'].forEach((command) =>
    writeFileSync(join(root, 'bin', command), stub, { mode: 0o755 })
  );
  const log = join(root, 'commands.jsonl');
  const release = (tag: string, assets: string[]) => {
    mkdirSync(join(github, tag));
    assets.forEach((asset) =>
      writeFileSync(
        join(github, tag, asset),
        asset === 'appcast.xml' ? appcast(tag.slice(1)) : 'dmg'
      )
    );
  };
  return {
    release,
    ready: (tag: string) => release(tag, ['MindRoom.dmg', 'appcast.xml']),
    live: (version?: string) => {
      mkdirSync(join(github, 'mac-appcast'));
      if (version) writeFileSync(join(github, 'mac-appcast', 'appcast.xml'), appcast(version));
    },
    feedNow: () => {
      const file = join(github, 'mac-appcast', 'appcast.xml');
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    },
    run: (tag: string, env: Record<string, string> = {}) => {
      const result = spawnSync('bash', [join(root, 'scripts/macos-publish-appcast.sh'), tag], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          GITHUB_REPOSITORY: 'mindroom-ai/mindroom-chat',
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
      return { ...result, commands };
    },
    uploads: (result: { commands: { command: string; args: string[] }[] }) =>
      result.commands.filter(({ command, args }) => command === 'gh' && args[1] === 'upload')
        .length,
  };
};

it.each([
  ['the first feed, on a prerelease it creates', undefined, 'v2026.11.10', {}, 1, '2026.11.10'],
  ['a feed lost by a failed replacement', 'none', 'v2026.11.10', {}, 1, '2026.11.10'],
  ['a newer release', '2026.11.9', 'v2026.11.10', {}, 1, '2026.11.10'],
  ['a newer month', '2026.11.99', 'v2026.12.0', {}, 1, '2026.12.0'],
  ['an older release whose run finishes last', '2026.11.10', 'v2026.11.9', {}, 0, '2026.11.10'],
  ['the same release again', '2026.11.10', 'v2026.11.10', {}, 0, '2026.11.10'],
  [
    'an upload that fails once',
    '2026.11.9',
    'v2026.11.10',
    { TEST_UPLOAD_FAILS: '1' },
    2,
    '2026.11.10',
  ],
  ['a URL that lags', '2026.11.9', 'v2026.11.10', { TEST_URL_LAGS: '3' }, 1, '2026.11.10'],
])('%s', (_name, before, tag, env, uploadCount, after) => {
  const github = fixture();
  if (before !== undefined) github.live(before === 'none' ? undefined : before);
  github.ready(tag);
  const result = github.run(tag, env);
  expect(result.status, result.stderr).toBe(0);
  expect(github.uploads(result)).toBe(uploadCount);
  expect(github.feedNow()).toBe(appcast(after));
});

it.each([
  ['has no DMG yet', ['appcast.xml']],
  ['has no appcast', ['MindRoom.dmg']],
])('writes nothing for a release that %s', (_name, assets) => {
  const github = fixture();
  github.live('2026.11.9');
  github.release('v2026.11.10', assets);
  const result = github.run('v2026.11.10');
  expect(result.status).toBe(0);
  expect(github.uploads(result)).toBe(0);
});

it.each([
  ['the feed cannot be read', { TEST_FAIL: 'view:mac-appcast' }, 0, '2026.11.9'],
  ['every upload fails', { TEST_UPLOAD_FAILS: '9' }, 3, undefined],
  ['the URL never serves it', { TEST_URL_LAGS: '999' }, 1, '2026.11.10'],
])('fails, without another write, when %s', (_name, env, uploadCount, after) => {
  const github = fixture();
  github.live('2026.11.9');
  github.ready('v2026.11.10');
  const result = github.run('v2026.11.10', env);
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain('::error::');
  expect(github.uploads(result)).toBe(uploadCount);
  expect(github.feedNow()).toBe(after === undefined ? undefined : appcast(after));
});
