import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/auto-mindroom-release.yml', 'utf8'));
const steps = workflow.jobs.macos_app.steps as {
  name: string;
  run?: string;
  if?: string;
  with?: { ref: string };
}[];
const sourceSha = 'a'.repeat(40);
const fixtures: string[] = [];
afterEach(() =>
  fixtures.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
);

// Run the actual workflow shell with GitHub responses replaced at the network boundary.
const runStep = (name: string, overrides: Record<string, string> = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'mindroom-macos-workflow-'));
  fixtures.push(root);
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'build/macos'), { recursive: true });
  writeFileSync(join(root, 'build/macos/MindRoom-Chat.dmg'), 'replacement');
  writeFileSync(
    join(root, 'assets.json'),
    JSON.stringify(
      overrides.TEST_NO_ORIGINAL ? [] : [{ id: 1, name: 'MindRoom-Chat.dmg', content: 'original' }]
    )
  );
  writeFileSync(
    join(root, 'bin/gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(args) + '\\n');
const stateFile = process.env.TEST_ASSETS;
let assets = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = () => fs.writeFileSync(stateFile, JSON.stringify(assets));
if (args[0] === 'release' && args[1] === 'upload') {
  const name = path.basename(args[3]);
  if (args.includes('--clobber')) { assets = assets.filter(a => a.name !== name); save(); }
  if (process.env.TEST_FAIL_UPLOAD) process.exit(9);
  assets.push({ id: 2, name, content: fs.readFileSync(args[3], 'utf8') }); save();
} else if (args[0] === 'api' && args[1].endsWith('/releases/tags/v4.12.6-mindroom.523')) {
  console.log(7);
} else if (args[0] === 'api' && args[1].endsWith('/releases/7/assets')) {
  const query = args[args.indexOf('--jq') + 1];
  const name = query.split('"')[1];
  console.log(assets.filter(a => a.name === name).map(a => a.id).join('\\n'));
} else if (args[0] === 'api' && args[1].includes('/releases/assets/')) {
  const id = Number(args[1].split('/').pop());
  const asset = assets.find(a => a.id === id);
  if (args.includes('DELETE')) { assets = assets.filter(a => a.id !== id); save(); }
  else if (args.includes('PATCH')) {
    const name = args.find(a => a.startsWith('name=')).slice(5);
    if (name === 'MindRoom-Chat.dmg' && id === 2 && process.env.TEST_FAIL_PROMOTE) process.exit(9);
    if (assets.some(a => a.id !== id && a.name === name)) process.exit(10);
    asset.name = name; save();
    if (process.env.TEST_LOST_BACKUP_RESPONSE && id === 1 && name !== 'MindRoom-Chat.dmg') process.exit(9);
    if (process.env.TEST_LOST_PROMOTE_RESPONSE && id === 2) process.exit(9);
  } else {
    if (process.env.TEST_FAIL_RECOVERY_READ && id === 1) process.exit(9);
    console.log(asset?.name ?? '');
  }
}
if (args.includes('targetCommitish')) console.log(process.env.TEST_RELEASE_SHA);
else if (args[0] === 'api' && args[1].includes('/commits/')) console.log(process.env.TEST_TAG_SHA);
else if (args.includes('tagName')) console.log(process.env.TEST_LATEST_TAG);
`,
    { mode: 0o755 }
  );
  const output = join(root, 'output');
  writeFileSync(output, '');
  const result = spawnSync(
    '/bin/bash',
    ['-e', '-c', steps.find((step) => step.name === name)!.run!],
    {
      encoding: 'utf8',
      cwd: root,
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'mindroom-ai/mindroom-chat',
        GITHUB_OUTPUT: output,
        RELEASE_TAG: 'v4.12.6-mindroom.523',
        TEST_RELEASE_SHA: sourceSha,
        TEST_TAG_SHA: sourceSha,
        TEST_LATEST_TAG: 'v4.12.6-mindroom.523',
        TEST_LOG: join(root, 'commands'),
        TEST_ASSETS: join(root, 'assets.json'),
        ...overrides,
      },
    }
  );
  return {
    ...result,
    output: readFileSync(output, 'utf8'),
    assets: JSON.parse(readFileSync(join(root, 'assets.json'), 'utf8')) as {
      id: number;
      name: string;
      content: string;
    }[],
    commands: readFileSync(join(root, 'commands'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]),
  };
};

describe('Mac release recovery', () => {
  it('pins checkout to the release commit after checking the tag still matches', () => {
    const result = runStep('Resolve existing release and version');
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toContain(`source_sha=${sourceSha}`);
    expect(steps.find((step) => step.name === 'Checkout release source')?.with?.ref).toBe(
      // Literal GitHub expression, evaluated by Actions rather than JavaScript.
      // eslint-disable-next-line no-template-curly-in-string
      '${{ steps.version.outputs.source_sha }}'
    );
  });

  it('rejects a moved tag before signing', () => {
    const result = runStep('Resolve existing release and version', {
      TEST_TAG_SHA: 'b'.repeat(40),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match');
    expect(result.output).not.toContain('source_sha=');
  });

  it('requires an immutable release target', () => {
    const result = runStep('Resolve existing release and version', { TEST_RELEASE_SHA: 'dev' });
    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain('source_sha=');
  });

  it('dispatches the tap update for the current release', () => {
    expect(runStep('Check latest release for tap update').output).toContain('is_latest=true');
    const result = runStep('Dispatch tap update');
    expect(result.status, result.stderr).toBe(0);
    expect(
      result.commands.some((args) => args[1] === 'repos/mindroom-ai/homebrew-tap/dispatches')
    ).toBe(true);
  });

  it('does not downgrade the tap when retrying an older release', () => {
    const result = runStep('Check latest release for tap update', {
      TEST_LATEST_TAG: 'v4.12.6-mindroom.524',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.output).toContain('is_latest=false');
    ['Mint Homebrew tap token', 'Dispatch tap update'].forEach((name) =>
      expect(steps.find((step) => step.name === name)?.if).toBe(
        // eslint-disable-next-line no-template-curly-in-string
        "${{ steps.tap_release.outputs.is_latest == 'true' }}"
      )
    );
  });
});

describe('Mac release asset replacement', () => {
  it('publishes the first asset without requiring a previous DMG', () => {
    const result = runStep('Upload DMG to release', { TEST_NO_ORIGINAL: '1' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.assets).toEqual([{ id: 2, name: 'MindRoom-Chat.dmg', content: 'replacement' }]);
  });

  it('restores the existing name if the backup rename response is lost', () => {
    const result = runStep('Upload DMG to release', { TEST_LOST_BACKUP_RESPONSE: '1' });
    expect(result.status).not.toBe(0);
    expect(result.assets).toContainEqual({ id: 1, name: 'MindRoom-Chat.dmg', content: 'original' });
  });

  it('reports the preserved backup if both rename response and recovery read fail', () => {
    const result = runStep('Upload DMG to release', {
      TEST_LOST_BACKUP_RESPONSE: '1',
      TEST_FAIL_RECOVERY_READ: '1',
    });
    expect(result.status).not.toBe(0);
    expect(result.assets.find((asset) => asset.id === 1)?.content).toBe('original');
    expect(result.stdout).toContain('Recover asset 1');
  });

  it('keeps the existing download when the replacement upload fails', () => {
    const result = runStep('Upload DMG to release', { TEST_FAIL_UPLOAD: '1' });
    expect(result.status).not.toBe(0);
    expect(result.assets).toContainEqual({ id: 1, name: 'MindRoom-Chat.dmg', content: 'original' });
  });

  it('restores the existing download when staged promotion fails', () => {
    const result = runStep('Upload DMG to release', { TEST_FAIL_PROMOTE: '1' });
    expect(result.status).not.toBe(0);
    expect(result.assets).toContainEqual({ id: 1, name: 'MindRoom-Chat.dmg', content: 'original' });
  });

  it('publishes the complete replacement before deleting the previous asset', () => {
    const result = runStep('Upload DMG to release');
    expect(result.status, result.stderr).toBe(0);
    expect(result.assets).toEqual([{ id: 2, name: 'MindRoom-Chat.dmg', content: 'replacement' }]);
  });

  it('reconciles a successful promotion whose API response was lost', () => {
    const result = runStep('Upload DMG to release', { TEST_LOST_PROMOTE_RESPONSE: '1' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.assets).toEqual([{ id: 2, name: 'MindRoom-Chat.dmg', content: 'replacement' }]);
  });
});
