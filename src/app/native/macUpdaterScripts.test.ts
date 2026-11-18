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
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify({ command, args }) + '\\n');
if (command === 'curl') fs.writeFileSync(args[args.indexOf('-o') + 1], 'garbage');
if (command === 'shasum') console.log('0000  file');
`;
  ['curl', 'shasum', 'tar', 'plutil'].forEach((command) =>
    writeFileSync(join(root, 'bin', command), stub, { mode: 0o755 })
  );
  const log = join(root, 'commands.jsonl');
  return {
    root,
    run: (script: string, env: Record<string, string> = {}) => {
      mkdirSync(dirname(join(root, script)), { recursive: true });
      copyFileSync(resolve(script), join(root, script));
      const result = spawnSync('bash', [join(root, script)], {
        cwd: root,
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
