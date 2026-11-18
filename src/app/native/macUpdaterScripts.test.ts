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
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const fixtures: string[] = [];
afterEach(() =>
  fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
);

type Command = { command: string; args: string[]; stdin?: string };

// The real scripts run in a temporary checkout; the tools they call are stubs that log each call.
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'mindroom-mac-updater-test-'));
  fixtures.push(root);
  mkdirSync(join(root, 'bin'));
  const stub = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const record = { command, args };
if (command === 'generate_appcast') {
  record.stdin = fs.readFileSync(0, 'utf8');
  fs.writeFileSync(args[args.indexOf('-o') + 1], process.env.TEST_FEED);
}
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(record) + '\\n');
if (command === 'curl') fs.writeFileSync(args[args.indexOf('-o') + 1], 'garbage');
if (command === 'shasum') console.log('0000  file');
// plutil: the keys in TEST_PRESENT are in the plist; TEST_FAIL=plutil:<flag> makes that call fail.
if (process.env.TEST_FAIL === command + ':' + args[0]) process.exit(1);
if (command === 'plutil' && args[0] === '-extract')
  process.exit((process.env.TEST_PRESENT ?? '').split(',').includes(args[1]) ? 0 : 1);
`;
  ['curl', 'shasum', 'tar', 'plutil'].forEach((command) =>
    writeFileSync(join(root, 'bin', command), stub, { mode: 0o755 })
  );
  const log = join(root, 'commands.jsonl');
  return {
    root,
    run: (script: string, env: Record<string, string> = {}, args: string[] = [], input = '') => {
      mkdirSync(dirname(join(root, script)), { recursive: true });
      copyFileSync(resolve(script), join(root, script));
      // Other scripts find Sparkle fetched: its download and its tool are stubs too.
      if (script !== 'scripts/fetch-sparkle.sh') {
        const tools = join(root, 'ios/MacUpdater/Sparkle/bin');
        mkdirSync(tools, { recursive: true });
        writeFileSync(join(tools, 'generate_appcast'), stub, { mode: 0o755 });
        writeFileSync(
          join(root, 'scripts/fetch-sparkle.sh'),
          stub.replace('path.basename(process.argv[1])', "'fetch-sparkle.sh'"),
          { mode: 0o755 }
        );
      }
      const result = spawnSync('bash', [join(root, script), ...args], {
        cwd: root,
        input,
        env: {
          ...process.env,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          TEST_LOG: log,
          ...env,
        },
        encoding: 'utf8',
      });
      const commands: Command[] = existsSync(log)
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as Command)
        : [];
      return { ...result, commands };
    },
  };
};

describe('scripts/fetch-sparkle.sh', () => {
  it('refuses a download whose checksum differs and leaves nothing behind', () => {
    const { root, run } = fixture();
    const result = run('scripts/fetch-sparkle.sh');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('checksum');
    expect(existsSync(join(root, 'ios/MacUpdater/Sparkle'))).toBe(false);
    expect(result.commands.find(({ command }) => command === 'curl')?.args).toContain(
      'https://github.com/sparkle-project/Sparkle/releases/download/2.10.1/Sparkle-2.10.1.tar.xz'
    );
  });

  it('downloads nothing when the pinned version is there', () => {
    const { root, run } = fixture();
    mkdirSync(join(root, 'ios/MacUpdater/Sparkle'), { recursive: true });
    writeFileSync(join(root, 'ios/MacUpdater/Sparkle/.version'), '2.10.1\n');
    const result = run('scripts/fetch-sparkle.sh');
    expect(result.status).toBe(0);
    expect(result.commands).toEqual([]);
  });
});

describe('scripts/macos-updater-info-plist.sh', () => {
  const KEY = `${'A'.repeat(42)}Q=`;
  const plist = '/b/A.app/Contents/Info.plist';
  const env = {
    IS_MACCATALYST: 'YES',
    MINDROOM_UPDATE_FEED_URL: 'https://example.invalid/appcast.xml',
    MINDROOM_UPDATE_PUBLIC_KEY: KEY,
    TARGET_BUILD_DIR: '/b',
    INFOPLIST_PATH: 'A.app/Contents/Info.plist',
  };

  it('writes the six keys into the built Mac app, also a second time', () => {
    const { run } = fixture();
    run('scripts/macos-updater-info-plist.sh', env);
    const result = run('scripts/macos-updater-info-plist.sh', env);
    expect(result.status, result.stderr).toBe(0);
    expect(result.commands.slice(-6).map(({ args }) => args)).toEqual([
      ['-replace', 'SUFeedURL', '-string', env.MINDROOM_UPDATE_FEED_URL, plist],
      ['-replace', 'SUPublicEDKey', '-string', KEY, plist],
      ['-replace', 'SUEnableAutomaticChecks', '-bool', 'YES', plist],
      ['-replace', 'SUAutomaticallyUpdate', '-bool', 'YES', plist],
      ['-replace', 'SUScheduledCheckInterval', '-integer', '3600', plist],
      ['-replace', 'SUVerifyUpdateBeforeExtraction', '-bool', 'YES', plist],
    ]);
  });

  it.each([{ IS_MACCATALYST: 'NO' }, { IS_MACCATALYST: '' }])(
    'touches nothing for %o',
    (override) => {
      const result = fixture().run('scripts/macos-updater-info-plist.sh', { ...env, ...override });
      expect(result.status).toBe(0);
      expect(result.commands).toEqual([]);
    }
  );

  const disabled = { ...env, MINDROOM_UPDATE_FEED_URL: '' };

  it.each([
    ['no feed', disabled],
    [
      'the placeholder key',
      { ...env, MINDROOM_UPDATE_PUBLIC_KEY: 'PLACEHOLDER-the-Sparkle-public-key' },
    ],
  ])('removes the keys an earlier build of the same app wrote, for %s', (_name, override) => {
    const result = fixture().run('scripts/macos-updater-info-plist.sh', {
      ...override,
      TEST_PRESENT: 'SUFeedURL,SUPublicEDKey',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(
      result.commands.filter(({ args }) => args[0] === '-remove').map(({ args }) => args)
    ).toEqual([
      ['-remove', 'SUFeedURL', plist],
      ['-remove', 'SUPublicEDKey', plist],
    ]);
  });

  it.each([
    ['a key it cannot remove', { TEST_PRESENT: 'SUFeedURL', TEST_FAIL: 'plutil:-remove' }],
    ['a plist it cannot read', { TEST_FAIL: 'plutil:-lint' }],
  ])('fails the build for %s, rather than leave the updater on', (_name, override) => {
    const result = fixture().run('scripts/macos-updater-info-plist.sh', {
      ...disabled,
      ...override,
    });
    expect(result.status).not.toBe(0);
  });

  it('fails the build for a feed without a valid public key', () => {
    const result = fixture().run('scripts/macos-updater-info-plist.sh', {
      ...env,
      MINDROOM_UPDATE_PUBLIC_KEY: 'short',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MINDROOM_UPDATE_PUBLIC_KEY');
    expect(result.commands).toEqual([]);
  });
});

describe('scripts/macos-appcast.sh', () => {
  const args = [
    'MindRoom.dmg',
    'https://example.invalid/v2026.11.10/',
    '2026.11.10',
    'appcast.xml',
  ];
  const item = ({
    version = '2026.11.10',
    url = 'https://example.invalid/v2026.11.10/MindRoom.dmg',
    length = 3,
    signature = 's1g=',
  } = {}) =>
    `<item><title>${version}</title><sparkle:version>${version}</sparkle:version><enclosure url="${url}" length="${length}" type="application/octet-stream" sparkle:edSignature="${signature}"/></item>`;
  // What generate_appcast writes: RSS with Sparkle's namespace.
  const feed = (...items: string[]) =>
    `<?xml version="1.0" standalone="yes"?>\n<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0"><channel><title>MindRoom</title>${items.join(
      ''
    )}</channel></rss>\n`;
  const withDmg = () => {
    const github = fixture();
    writeFileSync(join(github.root, 'MindRoom.dmg'), 'dmg');
    return github;
  };

  it('makes the feed in a fresh folder, with the key from standard input only', () => {
    const { root, run } = withDmg();
    writeFileSync(join(root, 'appcast.xml'), 'stale');
    const result = run('scripts/macos-appcast.sh', { TEST_FEED: feed(item()) }, args, 'KEY');
    expect(result.status, result.stderr).toBe(0);
    const tool = result.commands.find(({ command }) => command === 'generate_appcast')!;
    expect(tool.args.slice(0, 4)).toEqual(['--ed-key-file', '-', '--download-url-prefix', args[1]]);
    expect(tool.args[tool.args.indexOf('-o') + 1]).not.toBe(join(root, 'appcast.xml'));
    expect(tool.stdin).toBe('KEY');
    expect(result.stdout + result.stderr).not.toContain('KEY');
    expect(readFileSync(join(root, 'appcast.xml'), 'utf8')).toBe(feed(item()));
  });

  it.each([
    ['no signature (no SUPublicEDKey, or another key)', feed(item({ signature: '' }))],
    ['another version', feed(item({ version: '2026.11.9' }))],
    ['another URL', feed(item({ url: 'https://example.invalid/v2026.11.9/MindRoom.dmg' }))],
    ['another length', feed(item({ length: 4 }))],
    ['a second item', feed(item(), item({ version: '2026.11.9' }))],
    ['no item', feed()],
    ['no XML', 'Warning: could not sign'],
  ])('refuses %s and leaves no appcast', (_name, text) => {
    const { root, run } = withDmg();
    const result = run('scripts/macos-appcast.sh', { TEST_FEED: text }, args, 'KEY');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('appcast');
    expect(existsSync(join(root, 'appcast.xml'))).toBe(false);
  });

  it('refuses to run without a key', () => {
    const result = withDmg().run('scripts/macos-appcast.sh', {}, args, '');
    expect(result.status).not.toBe(0);
    expect(result.commands.some(({ command }) => command === 'generate_appcast')).toBe(false);
  });
});
