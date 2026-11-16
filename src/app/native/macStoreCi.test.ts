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
import { getSingleAppTargetBuildSettingValue } from '../../../scripts/ios-xcode-project.mjs';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const commit = '1111111111111111111111111111111111111111';
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'mindroom-mac-store-ci-'));
  roots.push(root);
  for (const file of [
    'ios/App/ci_scripts/ci_common.sh',
    'ios/App/ci_scripts/ci_pre_xcodebuild.sh',
    'ios/App/ci_scripts/ci_post_xcodebuild.sh',
    'ios/App/App.xcodeproj/project.pbxproj',
    'scripts/ios-ci-version.mjs',
    'scripts/calver.mjs',
    'scripts/ios-xcode-project.mjs',
    'scripts/macos-store-preflight.mjs',
    'scripts/build-macos-store.sh',
  ]) {
    if (!existsSync(resolve(file))) continue;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(resolve(file), join(root, file));
  }
  mkdirSync(join(root, 'bin'));
  const commands = join(root, 'commands.jsonl');
  const stub = `#!/usr/bin/env node
const fs = require('node:fs');
const name = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
if (name === 'git') {
  if (args.join(' ') === 'rev-parse HEAD') { console.log('${commit}'); process.exit(0); }
  if (args[0] === 'status') {
    if (process.env.TEST_DIRTY === '1') console.log(' M ios/App/App/SceneDelegate.swift');
    process.exit(0);
  }
  process.exit(1);
}
fs.appendFileSync(process.env.TEST_COMMANDS, JSON.stringify({name, args, release: process.env.MINDROOM_RELEASE_VERSION, commit: process.env.MINDROOM_BUILD_VERSION}) + '\\n');
`;
  ['npm', 'npx', 'pod', 'brew', 'git', 'xcodebuild'].forEach((name) =>
    writeFileSync(join(root, 'bin', name), stub, { mode: 0o755 })
  );
  const project = () => readFileSync(join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
  const run = (
    script: string,
    platform: string,
    overrides: Record<string, string> = {},
    args: string[] = []
  ) => {
    const result = spawnSync('/bin/bash', [join(root, script), ...args], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        CI: 'TRUE',
        CI_PRODUCT_PLATFORM: platform,
        CI_XCODE_SCHEME: platform === 'macOS' ? 'AppStoreMac' : 'App',
        CI_XCODEBUILD_ACTION: 'archive',
        CI_PRIMARY_REPOSITORY_PATH: root,
        CI_BUILD_NUMBER: '809',
        APP_STORE_MARKETING_VERSION: '2026.11.225',
        IOS_MARKETING_VERSION: '',
        IOS_BUILD_NUMBER: '',
        MINDROOM_BUILD_VERSION: 'caller-stamp',
        TEST_COMMANDS: commands,
        ...overrides,
      },
      encoding: 'utf8',
    });
    return {
      ...result,
      commands: existsSync(commands)
        ? readFileSync(commands, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : [],
    };
  };
  return { root, project, run };
};

describe('isolated Mac Store CI and archive entry points', () => {
  it.each(['macOS', 'iOS'])('versions only the targets of the %s action', (platform) => {
    const { project, run } = fixture();
    const before = project();
    const result = run('ios/App/ci_scripts/ci_pre_xcodebuild.sh', platform);
    expect(result.status, result.stderr).toBe(0);
    const selected =
      platform === 'macOS'
        ? ['AppStoreMac', 'MindRoomMacSupport']
        : ['App', 'MindRoomWatch', 'MindRoomWatchWidgets'];
    for (const target of [
      'App',
      'MindRoomWatch',
      'MindRoomWatchWidgets',
      'AppStoreMac',
      'MindRoomMacSupport',
    ]) {
      for (const [key, value] of [
        ['MARKETING_VERSION', '2026.11.225'],
        ['CURRENT_PROJECT_VERSION', '809'],
      ] as const) {
        expect(
          getSingleAppTargetBuildSettingValue(project(), key, target),
          `${platform}: ${target} ${key}`
        ).toBe(
          selected.includes(target)
            ? value
            : getSingleAppTargetBuildSettingValue(before, key, target)
        );
      }
    }
    const webBuild = result.commands.find(
      ({ name, args }) => name === 'npm' && args.join(' ') === 'run build:ios'
    );
    expect(webBuild).toMatchObject({
      release: 'v2026.11.225',
      commit: platform === 'macOS' ? commit : 'caller-stamp',
    });
  });

  it('does not inspect an iOS archive in the Mac post-build hook', () => {
    const result = fixture().run('ios/App/ci_scripts/ci_post_xcodebuild.sh', 'iOS', {
      CI_ARCHIVE_PATH: '/not-a-mac-archive',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.commands).toEqual([]);
  });

  it('rejects an invalid calendar version before a Mac web build', () => {
    const result = fixture().run('ios/App/ci_scripts/ci_pre_xcodebuild.sh', 'macOS', {
      APP_STORE_MARKETING_VERSION: '2026.13.1',
    });
    expect(result.status).not.toBe(0);
    expect(result.commands.some(({ name }) => name === 'npm')).toBe(false);
  });

  it('refuses a Mac archive action without its actual archive path', () => {
    const result = fixture().run('ios/App/ci_scripts/ci_post_xcodebuild.sh', 'macOS', {
      CI_ARCHIVE_PATH: '',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('CI_ARCHIVE_PATH');
  });

  it.each([
    { MARKETING_VERSION: '', CURRENT_PROJECT_VERSION: '809', field: 'MARKETING_VERSION' },
    { MARKETING_VERSION: '2026.13.1', CURRENT_PROJECT_VERSION: '809', field: 'MARKETING_VERSION' },
    {
      MARKETING_VERSION: '2026.11.225',
      CURRENT_PROJECT_VERSION: '0',
      field: 'CURRENT_PROJECT_VERSION',
    },
  ])(
    'rejects invalid local version inputs before any build command: $field',
    ({ field, ...env }) => {
      const result = fixture().run('scripts/build-macos-store.sh', 'macOS', env, ['--unsigned']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(field);
      expect(result.commands).toEqual([]);
    }
  );

  it('refuses to stamp uncommitted code as the candidate commit', () => {
    const result = fixture().run(
      'scripts/build-macos-store.sh',
      'macOS',
      { MARKETING_VERSION: '2026.11.225', CURRENT_PROJECT_VERSION: '809', TEST_DIRTY: '1' },
      ['--unsigned']
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('clean checkout');
    expect(result.commands).toEqual([]);
  });
});
