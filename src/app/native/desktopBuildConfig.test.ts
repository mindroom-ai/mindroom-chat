import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const require = createRequire(import.meta.url);
const read = (filePath: string) => readFileSync(resolve(filePath), 'utf8');

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function loadBuilderConfig(envOverrides: Record<string, string | undefined>) {
  const configPath = resolve('electron/builder.config.cjs');
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    delete require.cache[configPath];
    return require(configPath) as Record<string, any>;
  } finally {
    delete require.cache[configPath];
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function readPlistString(plistXml: string, key: string): string {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plistXml);
  expect(match, `missing ${key} in plist`).not.toBeNull();
  return match![1]!;
}

describe('electron/builder.config.cjs', () => {
  const rawConfig = read('electron/builder.config.cjs');
  const iosInfoPlist = read('ios/App/App/Info.plist');
  const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };

  it('passes electron-builder 26.18.0 schema validation in both unsigned and signed modes', async () => {
    const { validateConfiguration } = require('app-builder-lib/out/util/config/config') as {
      validateConfiguration: (config: unknown, logger: unknown) => Promise<void>;
    };
    const { DebugLogger } = require('builder-util') as {
      DebugLogger: new (isEnabled?: boolean) => unknown;
    };
    const logger = new DebugLogger(false);

    const unsignedCfg = loadBuilderConfig({
      MARKETING_VERSION: '',
      MINDROOM_DESKTOP_SIGN: '0',
    });
    const signedCfg = loadBuilderConfig({
      MARKETING_VERSION: '2026.11.9',
      MINDROOM_DESKTOP_SIGN: '1',
    });

    await expect(validateConfiguration(unsignedCfg, logger)).resolves.toBeUndefined();
    await expect(validateConfiguration(signedCfg, logger)).resolves.toBeUndefined();
  }, 15_000);

  it('pins final app identity, hardened runtime, usage descriptions, fuses, and artifact names', () => {
    const cfg = loadBuilderConfig({
      MARKETING_VERSION: '2026.11.9',
      MINDROOM_DESKTOP_SIGN: '1',
    });

    expect(cfg.appId).toBe('chat.mindroom.app');
    expect(cfg.productName).toBe('MindRoom Chat');
    expect(cfg.asar).toBe(true);
    expect(cfg.npmRebuild).toBe(false);
    expect(cfg.electronVersion).toBe(pkg.devDependencies.electron);
    expect(cfg.directories).toEqual({ output: 'build/desktop-dist' });
    expect(cfg.files).toEqual([
      'build/electron/**/*',
      'dist/**/*',
      'package.json',
      '!node_modules/**/*',
    ]);
    expect(cfg.buildVersion).toBe('2026.11.9');
    expect(cfg.extraMetadata).toEqual({ productName: 'MindRoom Chat', version: '2026.11.9' });
    expect(cfg.publish).toBeNull();

    expect(cfg.mac.hardenedRuntime).toBe(true);
    expect(cfg.mac.gatekeeperAssess).toBe(false);
    expect(cfg.mac.forceCodeSigning).toBe(true);
    expect(cfg.mac.notarize).toBe(true);
    expect(cfg.mac.bundleShortVersion).toBe('2026.11.9');
    expect(cfg.mac.bundleVersion).toBe('2026.11.9');
    expect(cfg.mac.entitlements).toBe('electron/entitlements.mac.plist');
    expect(cfg.mac.entitlementsInherit).toBe('electron/entitlements.helper.plist');
    expect(cfg.mac.icon).toBe(
      'ios/App/App/Assets.xcassets/AppIcon.appiconset/Icon-Mac-512x512@2x.png'
    );
    expect(cfg.mac.category).toBe('public.app-category.social-networking');
    expect(cfg.mac.artifactName).toBe('MindRoom-Chat-${arch}-mac.${ext}');
    expect(cfg.mac.target).toEqual([
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ]);

    expect(cfg.mac.extendInfo).toEqual({
      NSMicrophoneUsageDescription: readPlistString(iosInfoPlist, 'NSMicrophoneUsageDescription'),
      NSCameraUsageDescription: readPlistString(iosInfoPlist, 'NSCameraUsageDescription'),
      NSLocalNetworkUsageDescription: readPlistString(
        iosInfoPlist,
        'NSLocalNetworkUsageDescription'
      ),
      NSAudioCaptureUsageDescription:
        'MindRoom needs audio capture access to share system audio during screen sharing.',
      ITSAppUsesNonExemptEncryption: false,
    });
    expect(rawConfig).not.toContain('CFBundleURLTypes');
    expect(rawConfig).not.toContain('provisioningProfile');

    expect(cfg.dmg).toEqual({
      artifactName: 'MindRoom-Chat.dmg',
      title: 'MindRoom Chat',
      background: 'scripts/macos-dmg/background.png',
      window: { width: 660, height: 400 },
      iconSize: 128,
      writeUpdateInfo: false,
      contents: [
        { x: 180, y: 160 },
        { x: 480, y: 160, type: 'link', path: '/Applications' },
      ],
    });

    expect(cfg.electronFuses).toEqual({
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
    });

    const unsignedCfg = loadBuilderConfig({
      MARKETING_VERSION: '',
      MINDROOM_DESKTOP_SIGN: '0',
    });
    expect(unsignedCfg.mac.notarize).toBe(false);
    expect(unsignedCfg.mac.forceCodeSigning).toBe(false);
    expect(unsignedCfg.extraMetadata).toEqual({ productName: 'MindRoom Chat' });
    expect(unsignedCfg.buildVersion).toBeUndefined();
  });
});

describe('macOS entitlement plists', () => {
  it.each(['electron/entitlements.mac.plist', 'electron/entitlements.helper.plist'])(
    '%s grants only JIT, audio input, and camera with no restricted entitlements',
    (plistPath) => {
      const xml = read(plistPath);
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<!DOCTYPE plist');
      expect(xml).toContain('<plist version="1.0">');

      const keys = [...xml.matchAll(/<key>([^<]+)<\/key>\s*<(true|false)\/>/g)].map(
        ([, key, value]) => [key, value]
      );
      expect(keys).toEqual([
        ['com.apple.security.cs.allow-jit', 'true'],
        ['com.apple.security.device.audio-input', 'true'],
        ['com.apple.security.device.camera', 'true'],
      ]);

      for (const forbidden of [
        'aps-environment',
        'com.apple.developer.',
        'app-sandbox',
        'disable-library-validation',
      ]) {
        expect(xml).not.toContain(forbidden);
      }
    }
  );
});

describe('scripts/build-desktop-app.sh fail-closed checks', () => {
  type CommandRecord = {
    command: string;
    args: string[];
    hasNotarySecrets: boolean;
    cscName?: string;
    signEnv?: string;
  };

  function createFixture() {
    const root = mkdtempSync(join(tmpdir(), 'mindroom-desktop-build-'));
    tempDirs.push(root);
    for (const file of ['scripts/build-desktop-app.sh', 'scripts/desktop-latest-yml.mjs']) {
      const dest = join(root, file);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(resolve(file), dest);
    }
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'));
    mkdirSync(join(root, 'bin'));
    const logFile = join(root, 'commands.jsonl');

    const stubScript = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const record = {
  command: name,
  args,
  hasNotarySecrets: Boolean(process.env.APPLE_ID || process.env.APPLE_APP_SPECIFIC_PASSWORD),
  cscName: process.env.CSC_NAME,
  signEnv: process.env.MINDROOM_DESKTOP_SIGN,
};
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(record) + '\\n');

const failOn = process.env.TEST_FAIL || '';
const target = args[args.length - 1] || '';

if (name === 'npx' && args[0] === 'electron-builder') {
  const out = path.join(process.cwd(), 'build/desktop-dist');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'MindRoom-Chat.dmg'), 'fake-dmg');
  fs.writeFileSync(path.join(out, 'MindRoom-Chat-arm64-mac.zip'), 'fake-arm64-zip');
  fs.writeFileSync(path.join(out, 'MindRoom-Chat-x64-mac.zip'), 'fake-x64-zip');
  fs.writeFileSync(path.join(out, 'MindRoom-Chat-arm64-mac.zip.blockmap'), 'fake-arm64-bm');
  fs.writeFileSync(path.join(out, 'MindRoom-Chat-x64-mac.zip.blockmap'), 'fake-x64-bm');
  process.exit(0);
}

if (name === 'ditto') {
  const destDir = args[args.length - 1];
  const appDir = path.join(destDir, 'MindRoom Chat.app');
  if (process.env.TEST_MISSING_APP !== '1') {
    fs.mkdirSync(appDir, { recursive: true });
  }
  process.exit(0);
}

if (name === 'codesign') {
  if (args[0] === '--verify') {
    if (failOn === 'codesign:verify:dmg' && target.endsWith('.dmg')) process.exit(1);
    if (failOn === 'codesign:verify:app' && target.endsWith('.app')) process.exit(1);
    process.exit(0);
  }
  if (args[0] === '-dv') {
    const isApp = target.endsWith('.app');
    const authority = process.env.TEST_AUTHORITY || 'Developer ID Application: MindRoom AI (DNA6966LGZ)';
    const team = process.env.TEST_TEAM || 'DNA6966LGZ';
    const flags = isApp ? (process.env.TEST_APP_FLAGS || '0x10000(runtime)') : '0x0(none)';
    console.error('Executable=' + target);
    console.error('Authority=' + authority);
    console.error('TeamIdentifier=' + team);
    console.error('CodeDirectory v=20500 size=100 flags=' + flags);
    process.exit(0);
  }
  process.exit(0);
}

if (name === 'xcrun') {
  if (args[0] === 'stapler' && args[1] === 'validate') {
    if (failOn === 'stapler:dmg' && target.endsWith('.dmg')) {
      console.error('The validate action failed! (65)');
      process.exit(65);
    }
    if (failOn === 'stapler:app' && target.endsWith('.app')) {
      console.error('The validate action failed! (65)');
      process.exit(65);
    }
  }
  if (args[0] === 'notarytool' && failOn === 'notarytool') {
    process.exit(9);
  }
  process.exit(0);
}

if (name === 'spctl') {
  if (failOn === 'spctl:dmg' && target.endsWith('.dmg')) process.exit(3);
  if (failOn === 'spctl:app' && target.endsWith('.app')) process.exit(3);
  process.exit(0);
}
`;

    for (const tool of ['npm', 'npx', 'codesign', 'xcrun', 'spctl', 'ditto']) {
      writeFileSync(join(root, 'bin', tool), stubScript, { mode: 0o755 });
    }

    const run = (args: string[], envOverrides: Record<string, string> = {}) => {
      const bashBin = process.platform === 'darwin' ? '/bin/bash' : 'bash';
      const result = spawnSync(bashBin, [join(root, 'scripts/build-desktop-app.sh'), ...args], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          NODE_PATH: resolve('node_modules'),
          TEST_LOG: logFile,
          CODESIGN_IDENTITY: 'Developer ID Application: MindRoom AI (DNA6966LGZ)',
          APPLE_ID: 'release@mindroom.chat',
          APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
          APPLE_TEAM_ID: 'DNA6966LGZ',
          MARKETING_VERSION: '2026.11.9',
          GITHUB_REPOSITORY: 'mindroom-ai/mindroom-chat',
          ...envOverrides,
        },
        encoding: 'utf8',
      });
      const commands: CommandRecord[] = existsSync(logFile)
        ? readFileSync(logFile, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as CommandRecord)
        : [];
      return { ...result, commands };
    };

    return { root, run };
  }

  function makeArtifacts(root: string) {
    const dir = join(root, 'artifacts');
    mkdirSync(dir, { recursive: true });
    const dmg = join(dir, 'MindRoom-Chat.dmg');
    const arm64 = join(dir, 'MindRoom-Chat-arm64-mac.zip');
    const x64 = join(dir, 'MindRoom-Chat-x64-mac.zip');
    writeFileSync(dmg, 'dmg-bytes');
    writeFileSync(arm64, 'arm64-bytes');
    writeFileSync(x64, 'x64-bytes');
    return { dmg, arm64, x64 };
  }

  it.each([
    ['missing APPLE_ID', { APPLE_ID: '' }, 'APPLE_ID'],
    [
      'missing APPLE_APP_SPECIFIC_PASSWORD',
      { APPLE_APP_SPECIFIC_PASSWORD: '' },
      'APPLE_APP_SPECIFIC_PASSWORD',
    ],
    ['missing APPLE_TEAM_ID', { APPLE_TEAM_ID: '' }, 'APPLE_TEAM_ID'],
    ['missing CODESIGN_IDENTITY', { CODESIGN_IDENTITY: '' }, 'CODESIGN_IDENTITY'],
    ['missing MARKETING_VERSION', { MARKETING_VERSION: '' }, 'MARKETING_VERSION'],
    ['wrong APPLE_TEAM_ID', { APPLE_TEAM_ID: 'WRONGTEAM1' }, 'DNA6966LGZ'],
    [
      'wrong CODESIGN_IDENTITY',
      { CODESIGN_IDENTITY: 'Mac Developer: Someone (DNA6966LGZ)' },
      'DNA6966LGZ',
    ],
    ['leading-v MARKETING_VERSION', { MARKETING_VERSION: 'v2026.11.9' }, 'MARKETING_VERSION'],
  ])('fails closed before building when --sign has %s', (_label, overrides, expectedError) => {
    const result = createFixture().run(['--sign'], overrides);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(expectedError);
    expect(result.commands).toEqual([]);
  });

  it('passes --verify-only when DMG and both unpacked apps are signed, stapled, and pass spctl, never running spctl on ZIPs', () => {
    const { root, run } = createFixture();
    const { dmg, arm64, x64 } = makeArtifacts(root);

    const result = run(['--verify-only', dmg, arm64, x64]);
    expect(result.status, result.stderr).toBe(0);

    const spctlCalls = result.commands.filter((c) => c.command === 'spctl');
    expect(spctlCalls).toHaveLength(3);
    expect(spctlCalls[0]?.args).toEqual([
      '--assess',
      '--type',
      'open',
      '--context',
      'context:primary-signature',
      dmg,
    ]);
    for (const appCall of spctlCalls.slice(1)) {
      expect(appCall.args.slice(0, 3)).toEqual(['--assess', '--type', 'execute']);
      expect(appCall.args[3]).toMatch(/\/MindRoom Chat\.app$/);
    }
    expect(spctlCalls.some((c) => c.args.some((arg) => arg.endsWith('.zip')))).toBe(false);

    const staplerCalls = result.commands.filter(
      (c) => c.command === 'xcrun' && c.args[0] === 'stapler' && c.args[1] === 'validate'
    );
    expect(staplerCalls).toHaveLength(3);
  });

  it.each([
    ['fake unstapled .app inside a ZIP', { TEST_FAIL: 'stapler:app' }],
    ['unstapled DMG', { TEST_FAIL: 'stapler:dmg' }],
    ['wrong TeamIdentifier', { TEST_TEAM: 'OTHERTEAM1' }],
    [
      'missing Developer ID Application authority',
      { TEST_AUTHORITY: 'Apple Development: Dev (DNA6966LGZ)' },
    ],
    ['missing hardened runtime on .app', { TEST_APP_FLAGS: '0x0(none)' }],
    ['failed spctl on DMG', { TEST_FAIL: 'spctl:dmg' }],
    ['failed spctl on unpacked .app', { TEST_FAIL: 'spctl:app' }],
    ['failed codesign --verify on unpacked .app', { TEST_FAIL: 'codesign:verify:app' }],
  ])('--verify-only fails closed on %s', (_label, overrides) => {
    const { root, run } = createFixture();
    const { dmg, arm64, x64 } = makeArtifacts(root);
    const result = run(['--verify-only', dmg, arm64, x64], overrides);
    expect(result.status).not.toBe(0);
  });

  it('runs the full --sign lifecycle without exposing notary secrets to npm build:desktop and strips CSC_NAME prefix for electron-builder', () => {
    const { root, run } = createFixture();
    const result = run(['--sign']);
    expect(result.status, result.stderr).toBe(0);

    const npmBuild = result.commands.find(
      (c) => c.command === 'npm' && c.args.join(' ') === 'run build:desktop'
    );
    expect(npmBuild).toBeDefined();
    expect(npmBuild?.hasNotarySecrets).toBe(false);

    const eb = result.commands.find((c) => c.command === 'npx' && c.args[0] === 'electron-builder');
    expect(eb).toBeDefined();
    expect(eb?.signEnv).toBe('1');
    expect(eb?.hasNotarySecrets).toBe(true);
    expect(eb?.cscName).toBe('MindRoom AI (DNA6966LGZ)');

    const dmgSign = result.commands.find(
      (c) => c.command === 'codesign' && c.args[0] === '--force'
    );
    expect(dmgSign?.args).toEqual([
      '--force',
      '--sign',
      'Developer ID Application: MindRoom AI (DNA6966LGZ)',
      '--timestamp',
      'build/desktop-dist/MindRoom-Chat.dmg',
    ]);

    const latestYml = parse(
      readFileSync(join(root, 'build/desktop-dist/latest-mac.yml'), 'utf8')
    ) as {
      version: string;
      files: Array<{ url: string }>;
    };
    expect(latestYml.version).toBe('2026.11.9');
    expect(latestYml.files.map((f) => f.url)).toEqual([
      'https://github.com/mindroom-ai/mindroom-chat/releases/download/v2026.11.9/MindRoom-Chat-arm64-mac.zip',
      'https://github.com/mindroom-ai/mindroom-chat/releases/download/v2026.11.9/MindRoom-Chat-x64-mac.zip',
    ]);
  }, 15_000);
});

describe('desktop.yml and release.yml workflow wiring', () => {
  const releaseWorkflow = read('.github/workflows/release.yml');
  const desktopWorkflow = read('.github/workflows/desktop.yml');

  it('routes release.yml macos job to desktop.yml instead of macos.yml', () => {
    const parsed = parse(releaseWorkflow) as {
      jobs: { macos: { uses: string; secrets: string } };
    };
    expect(parsed.jobs.macos.uses).toBe('./.github/workflows/desktop.yml');
    expect(parsed.jobs.macos.secrets).toBe('inherit');
    expect(releaseWorkflow).not.toContain('macos.yml');
  });

  it('signs and publishes only for a published stable release tag, never replaces assets, and uses no provisioning profile', () => {
    type Step = {
      name?: string;
      run?: string;
      uses?: string;
      if?: string;
      with?: Record<string, unknown>;
    };
    const parsed = parse(desktopWorkflow) as {
      on: {
        workflow_call: { inputs: Record<string, unknown> };
        workflow_dispatch: { inputs: Record<string, unknown> };
        release: { types: string[] };
        pull_request: { paths: string[] };
      };
      jobs: {
        e2e: { if?: string; steps: Step[] };
        release: {
          if?: string;
          permissions?: Record<string, string>;
          concurrency?: { group: string; 'cancel-in-progress': boolean };
          steps: Step[];
        };
      };
    };

    expect(Object.keys(parsed.on.workflow_call.inputs)).toEqual(['tag']);
    expect(Object.keys(parsed.on.workflow_dispatch.inputs)).toEqual(['tag']);
    expect(parsed.on.release.types).toEqual(['published']);
    expect(parsed.jobs.e2e.if).toBe("github.event_name == 'pull_request'");
    const e2eCheckout = parsed.jobs.e2e.steps.find((s) => s.uses?.startsWith('actions/checkout'));
    expect(e2eCheckout?.with?.['persist-credentials']).toBe(false);

    const releaseJob = parsed.jobs.release;
    expect(releaseJob.permissions).toEqual({ contents: 'write' });
    expect(releaseJob.if).toBe(
      "github.event_name != 'pull_request' && (github.event_name != 'release' || !github.event.release.prerelease)"
    );
    expect(releaseJob.concurrency?.['cancel-in-progress']).toBe(false);

    const checkStep = releaseJob.steps.find((s) => s.name === 'Check the release');
    expect(checkStep?.run).toContain('if [[ -z ${RELEASE_TAG:-} ]]; then');
    expect(checkStep?.run).toContain('^v[0-9]{4}\\.([1-9]|1[0-2])\\.(0|[1-9][0-9]*)$');
    expect(checkStep?.run).toContain('--json isDraft,isPrerelease');
    expect(checkStep?.run).toContain('MindRoom-Chat.dmg');
    expect(checkStep?.run).toContain('MindRoom-Chat-arm64-mac.zip');
    expect(checkStep?.run).toContain('MindRoom-Chat-x64-mac.zip');

    const releaseCheckout = releaseJob.steps.find((s) => s.uses?.startsWith('actions/checkout'));
    expect(releaseCheckout?.with).toEqual({
      ref: 'refs/tags/${{ env.RELEASE_TAG }}',
      'persist-credentials': false,
    });

    const uploadStep = releaseJob.steps.find(
      (s) => s.name === 'Attach verified artifacts to the release'
    );
    expect(uploadStep?.run).toContain('gh release upload "$RELEASE_TAG"');
    expect(uploadStep?.run).toContain('build/desktop-dist/MindRoom-Chat-arm64-mac.zip.blockmap');
    expect(uploadStep?.run).toContain('build/desktop-dist/MindRoom-Chat-x64-mac.zip.blockmap');
    expect(uploadStep?.run).not.toContain('if [[ -f');
    expect(uploadStep?.run).not.toContain('--clobber');

    expect(desktopWorkflow).not.toContain('PROVISIONING_PROFILE');
    expect(desktopWorkflow).not.toContain('provisionprofile');
  });
});
