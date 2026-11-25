import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  fetchDesktopHelper,
  readHelperPin,
  verifyTarballSha256,
} from '../../../scripts/fetch-desktop-helper.mjs';

const require = createRequire(import.meta.url);
const read = (filePath: string) => readFileSync(resolve(filePath), 'utf8');
const tempDirs: string[] = [];
const PENDING_SHA256 = '0'.repeat(64);
const HELPER_BUNDLE_NAME = 'MindRoom Desktop Helper.app';
const HELPER_EXEC_REL = join('Contents', 'MacOS', 'MindRoom Desktop Helper');

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createFakeHelperBundle(appDir: string, content = 'helper-bin'): void {
  const execPath = join(appDir, HELPER_EXEC_REL);
  mkdirSync(dirname(execPath), { recursive: true });
  writeFileSync(execPath, content);
  chmodSync(execPath, 0o755);
  const fwDir = join(appDir, 'Contents', 'Frameworks');
  mkdirSync(join(fwDir, 'Versions', '3.12'), { recursive: true });
  writeFileSync(join(fwDir, 'Versions', '3.12', 'Python'), 'py');
  symlinkSync('Versions/3.12', join(fwDir, 'Current'));
}

function loadBuilderConfig(envOverrides: Record<string, string>) {
  const configPath = resolve('electron/builder.config.cjs');
  const saved = Object.fromEntries(Object.keys(envOverrides).map((k) => [k, process.env[k]]));
  Object.assign(process.env, envOverrides);
  try {
    delete require.cache[configPath];
    return require(configPath) as Record<string, any>;
  } finally {
    delete require.cache[configPath];
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('electron/builder.config.cjs and macOS entitlements', () => {
  it('passes real app-builder-lib schema validation in unsigned and signed modes', async () => {
    const { validateConfiguration } = require('app-builder-lib/out/util/config/config') as {
      validateConfiguration: (config: unknown, logger: unknown) => Promise<void>;
    };
    const { DebugLogger } = require('builder-util') as {
      DebugLogger: new (isEnabled?: boolean) => unknown;
    };
    const logger = new DebugLogger(false);
    await expect(
      validateConfiguration(
        loadBuilderConfig({ MARKETING_VERSION: '', MINDROOM_DESKTOP_SIGN: '0' }),
        logger
      )
    ).resolves.toBeUndefined();
    await expect(
      validateConfiguration(
        loadBuilderConfig({ MARKETING_VERSION: '2026.11.9', MINDROOM_DESKTOP_SIGN: '1' }),
        logger
      )
    ).resolves.toBeUndefined();
  }, 15_000);

  it('pins names, hardened runtime, entitlements, fuses, helper afterPack/signIgnore, and artifacts', () => {
    const rawConfig = read('electron/builder.config.cjs');
    const signed = loadBuilderConfig({
      MARKETING_VERSION: '2026.11.9',
      MINDROOM_DESKTOP_SIGN: '1',
    });
    const unsigned = loadBuilderConfig({ MARKETING_VERSION: '', MINDROOM_DESKTOP_SIGN: '0' });

    expect(signed).toMatchObject({
      appId: 'chat.mindroom.app',
      productName: 'MindRoom Chat',
      afterPack: 'electron/afterPack.cjs',
      asar: true,
      npmRebuild: false,
      buildVersion: '2026.11.9',
      publish: {
        provider: 'generic',
        url: 'https://github.com/mindroom-ai/mindroom-chat/releases/download/mac-feed',
        useMultipleRangeRequest: false,
      },
      extraMetadata: { productName: 'MindRoom Chat', version: '2026.11.9' },
      directories: { output: 'build/desktop-dist' },
      extraResources: [
        { from: 'build/electron/mindroom-screenshot-helper', to: 'mindroom-screenshot-helper' },
      ],
      mac: {
        artifactName: 'MindRoom-Chat-${arch}-mac.${ext}',
        bundleShortVersion: '2026.11.9',
        bundleVersion: '2026.11.9',
        hardenedRuntime: true,
        gatekeeperAssess: false,
        forceCodeSigning: true,
        notarize: true,
        entitlements: 'electron/entitlements.mac.plist',
        entitlementsInherit: 'electron/entitlements.helper.plist',
        signIgnore: ['Contents/Helpers/MindRoom Desktop Helper\\.app(/|$)'],
        target: [
          { target: 'dmg', arch: ['universal'] },
          { target: 'zip', arch: ['arm64', 'x64'] },
        ],
      },
      dmg: { artifactName: 'MindRoom-Chat.dmg', title: 'MindRoom Chat', writeUpdateInfo: false },
    });

    expect(signed.files).toContain('!build/electron/MindRoom Desktop Helper.app/**');
    const signIgnoreRe = new RegExp(signed.mac.signIgnore[0] as string);
    expect(
      signIgnoreRe.test('/app/MindRoom Chat.app/Contents/Helpers/MindRoom Desktop Helper.app')
    ).toBe(true);
    expect(
      signIgnoreRe.test(
        '/app/MindRoom Chat.app/Contents/Helpers/MindRoom Desktop Helper.app/Contents/MacOS/MindRoom Desktop Helper'
      )
    ).toBe(true);
    expect(
      signIgnoreRe.test('/app/MindRoom Chat.app/Contents/Resources/mindroom-screenshot-helper')
    ).toBe(false);
    expect(
      signIgnoreRe.test('/app/MindRoom Chat.app/Contents/Helpers/MindRoom Desktop Helper.app.evil')
    ).toBe(false);

    const baseFuses = {
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
    };
    expect(signed.electronFuses).toEqual({ ...baseFuses, resetAdHocDarwinSignature: false });
    expect(unsigned.electronFuses).toEqual({ ...baseFuses, resetAdHocDarwinSignature: true });
    expect(unsigned.extraMetadata).toEqual({ productName: 'MindRoom Chat' });
    expect(unsigned.mac).toMatchObject({ notarize: false, forceCodeSigning: false });
    expect(rawConfig).not.toContain('CFBundleURLTypes');
    expect(rawConfig).not.toContain('provisioningProfile');

    for (const plist of ['electron/entitlements.mac.plist', 'electron/entitlements.helper.plist']) {
      const xml = read(plist);
      const keys = [...xml.matchAll(/<key>([^<]+)<\/key>\s*<(true|false)\/>/g)].map((m) => [
        m[1],
        m[2],
      ]);
      expect(keys).toEqual([
        ['com.apple.security.cs.allow-jit', 'true'],
        ['com.apple.security.device.audio-input', 'true'],
        ['com.apple.security.device.camera', 'true'],
      ]);
      for (const bad of [
        'aps-environment',
        'com.apple.developer.',
        'app-sandbox',
        'disable-library-validation',
      ]) {
        expect(xml).not.toContain(bad);
      }
    }
  });
});

describe('electron/afterPack.cjs', () => {
  const { Arch } = require('app-builder-lib') as {
    Arch: { x64: number; arm64: number; universal: number };
  };

  function makeAfterPackFixture(prefix: string) {
    const root = makeTempDir(prefix);
    mkdirSync(join(root, 'electron'), { recursive: true });
    const hookPath = join(root, 'electron', 'afterPack.cjs');
    copyFileSync(resolve('electron/afterPack.cjs'), hookPath);
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'));
    const defaultStaged = join(root, 'build', 'electron', HELPER_BUNDLE_NAME);
    return { root, hookPath, defaultStaged };
  }

  async function runAfterPack(
    context: {
      electronPlatformName: string;
      arch: number;
      appOutDir: string;
      packager: { appInfo: { productFilename: string } };
    },
    envOverrides: Record<string, string | undefined>,
    hookPath = resolve('electron/afterPack.cjs')
  ) {
    const saved = Object.fromEntries(Object.keys(envOverrides).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(envOverrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      delete require.cache[hookPath];
      const afterPack = require(hookPath) as (ctx: typeof context) => Promise<void>;
      await afterPack(context);
    } finally {
      delete require.cache[hookPath];
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  function makePackContext(appOutDir: string, arch: number, electronPlatformName = 'darwin') {
    mkdirSync(join(appOutDir, 'MindRoom Chat.app', 'Contents'), { recursive: true });
    return {
      electronPlatformName,
      arch,
      appOutDir,
      packager: { appInfo: { productFilename: 'MindRoom Chat' } },
    };
  }

  it.each([
    ['arm64', Arch.arm64, 'mac-arm64'],
    ['universal', Arch.universal, 'mac-universal'],
  ])(
    'bundles helper into Contents/Helpers for %s preserving symlinks and permissions',
    async (_label, arch, dirName) => {
      const { root, hookPath, defaultStaged } = makeAfterPackFixture('mindroom-afterpack-');
      createFakeHelperBundle(defaultStaged, 'fresh-helper');
      const appOutDir = join(root, dirName);
      const context = makePackContext(appOutDir, arch);
      const dest = join(appOutDir, 'MindRoom Chat.app', 'Contents', 'Helpers', HELPER_BUNDLE_NAME);
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, 'stale.txt'), 'old');

      await runAfterPack(
        context,
        {
          MINDROOM_DESKTOP_HELPER_STAGED: undefined,
          MINDROOM_DESKTOP_SIGN: '1',
        },
        hookPath
      );

      expect(existsSync(join(dest, 'stale.txt'))).toBe(false);
      expect(readFileSync(join(dest, HELPER_EXEC_REL), 'utf8')).toBe('fresh-helper');
      expect(statSync(join(dest, HELPER_EXEC_REL)).mode & 0o111).not.toBe(0);
      const linkPath = join(dest, 'Contents', 'Frameworks', 'Current');
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(linkPath)).toBe('Versions/3.12');
    }
  );

  it.each([
    ['x64', Arch.x64, 'mac', 'darwin'],
    ['universal -arm64-temp', Arch.arm64, 'mac-universal-arm64-temp', 'darwin'],
    ['universal -x64-temp', Arch.x64, 'mac-universal-x64-temp', 'darwin'],
    ['non-darwin platform', Arch.arm64, 'linux-arm64', 'linux'],
  ])(
    'skips helper bundling for %s even in signed mode',
    async (_label, arch, dirName, platform) => {
      const { root, hookPath, defaultStaged } = makeAfterPackFixture('mindroom-afterpack-skip-');
      createFakeHelperBundle(defaultStaged);
      const appOutDir = join(root, dirName);
      const context = makePackContext(appOutDir, arch, platform);

      await runAfterPack(
        context,
        {
          MINDROOM_DESKTOP_HELPER_STAGED: undefined,
          MINDROOM_DESKTOP_SIGN: '1',
        },
        hookPath
      );

      const dest = join(appOutDir, 'MindRoom Chat.app', 'Contents', 'Helpers', HELPER_BUNDLE_NAME);
      expect(existsSync(dest)).toBe(false);
    }
  );

  it.each([
    ['arm64', Arch.arm64, 'mac-arm64'],
    ['universal', Arch.universal, 'mac-universal'],
  ])(
    'fails closed in signed mode when staged helper is missing (%s)',
    async (_label, arch, dirName) => {
      const { root, hookPath } = makeAfterPackFixture('mindroom-afterpack-missing-');
      const appOutDir = join(root, dirName);
      const context = makePackContext(appOutDir, arch);

      await expect(
        runAfterPack(
          context,
          {
            MINDROOM_DESKTOP_HELPER_STAGED: undefined,
            MINDROOM_DESKTOP_SIGN: '1',
          },
          hookPath
        )
      ).rejects.toThrow(/MindRoom Desktop Helper/);
    }
  );

  it('ignores MINDROOM_DESKTOP_HELPER_STAGED in signed mode and honors it only in unsigned mode', async () => {
    const { root, hookPath, defaultStaged } = makeAfterPackFixture('mindroom-afterpack-signed-ignore-');
    const overrideHelper = join(root, 'override', HELPER_BUNDLE_NAME);
    createFakeHelperBundle(overrideHelper, 'override-helper');

    // Without the official build/electron staged helper, signed mode fails closed even when override env is set.
    const appOutMissing = join(root, 'mac-arm64-missing');
    await expect(
      runAfterPack(
        makePackContext(appOutMissing, Arch.arm64),
        {
          MINDROOM_DESKTOP_HELPER_STAGED: overrideHelper,
          MINDROOM_DESKTOP_SIGN: '1',
        },
        hookPath
      )
    ).rejects.toThrow(/MindRoom Desktop Helper/);

    // When both official and override exist, signed mode bundles the official staged helper only.
    createFakeHelperBundle(defaultStaged, 'official-helper');
    const appOutSigned = join(root, 'mac-arm64-signed');
    await runAfterPack(
      makePackContext(appOutSigned, Arch.arm64),
      {
        MINDROOM_DESKTOP_HELPER_STAGED: overrideHelper,
        MINDROOM_DESKTOP_SIGN: '1',
      },
      hookPath
    );
    const signedDest = join(
      appOutSigned,
      'MindRoom Chat.app',
      'Contents',
      'Helpers',
      HELPER_BUNDLE_NAME,
      HELPER_EXEC_REL
    );
    expect(readFileSync(signedDest, 'utf8')).toBe('official-helper');

    // Unsigned mode still honors MINDROOM_DESKTOP_HELPER_STAGED.
    const appOutUnsigned = join(root, 'mac-arm64-unsigned');
    await runAfterPack(
      makePackContext(appOutUnsigned, Arch.arm64),
      {
        MINDROOM_DESKTOP_HELPER_STAGED: overrideHelper,
        MINDROOM_DESKTOP_SIGN: '0',
      },
      hookPath
    );
    const unsignedDest = join(
      appOutUnsigned,
      'MindRoom Chat.app',
      'Contents',
      'Helpers',
      HELPER_BUNDLE_NAME,
      HELPER_EXEC_REL
    );
    expect(readFileSync(unsignedDest, 'utf8')).toBe('override-helper');
  });

  it('skips silently in unsigned mode when staged helper is missing', async () => {
    const { root, hookPath } = makeAfterPackFixture('mindroom-afterpack-unsigned-');
    const appOutDir = join(root, 'mac-arm64');
    const context = makePackContext(appOutDir, Arch.arm64);

    await expect(
      runAfterPack(
        context,
        {
          MINDROOM_DESKTOP_HELPER_STAGED: join(root, 'does-not-exist.app'),
          MINDROOM_DESKTOP_SIGN: '0',
        },
        hookPath
      )
    ).resolves.toBeUndefined();

    const dest = join(appOutDir, 'MindRoom Chat.app', 'Contents', 'Helpers', HELPER_BUNDLE_NAME);
    expect(existsSync(dest)).toBe(false);
  });

  it('fails closed when staged helper directory is missing the helper executable', async () => {
    const { root, hookPath } = makeAfterPackFixture('mindroom-afterpack-corrupt-');
    const staged = join(root, HELPER_BUNDLE_NAME);
    mkdirSync(staged, { recursive: true });
    const appOutDir = join(root, 'mac-arm64');
    const context = makePackContext(appOutDir, Arch.arm64);

    await expect(
      runAfterPack(
        context,
        {
          MINDROOM_DESKTOP_HELPER_STAGED: staged,
          MINDROOM_DESKTOP_SIGN: '0',
        },
        hookPath
      )
    ).rejects.toThrow(/MindRoom Desktop Helper/);
  });
});

describe('scripts/desktop-helper-pin.json and scripts/fetch-desktop-helper.mjs', () => {
  function createHelperTarball(dir: string, content = 'real-helper-bin') {
    const stage = join(dir, 'tar-src');
    const appDir = join(stage, HELPER_BUNDLE_NAME);
    createFakeHelperBundle(appDir, content);
    const tarball = join(dir, 'MindRoom-Desktop-Helper-arm64.tar.gz');
    const tar = spawnSync('tar', ['-czf', tarball, '-C', stage, HELPER_BUNDLE_NAME], {
      encoding: 'utf8',
    });
    expect(tar.status, tar.stderr).toBe(0);
    const sha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex');
    return { tarball, sha256 };
  }

  function writePin(dir: string, overrides: Record<string, unknown> = {}) {
    const pinPath = join(dir, 'desktop-helper-pin.json');
    writeFileSync(
      pinPath,
      JSON.stringify({
        repo: 'mindroom-ai/mindroom',
        tag: 'v2026.11.568',
        asset: 'MindRoom-Desktop-Helper-arm64.tar.gz',
        sha256: 'a'.repeat(64),
        bundleId: 'chat.mindroom.desktophelper',
        teamId: 'DNA6966LGZ',
        ...overrides,
      }),
      'utf8'
    );
    return pinPath;
  }

  it('validates the committed scripts/desktop-helper-pin.json fields', () => {
    const pin = readHelperPin(resolve('scripts/desktop-helper-pin.json'));
    expect(pin).toMatchObject({
      repo: 'mindroom-ai/mindroom',
      tag: 'v2026.11.572',
      asset: 'MindRoom-Desktop-Helper-arm64.tar.gz',
      sha256: '32fa53d617c9e2af1c0263931b7675294e940e2d18d3869ca1dc488b3ede6204',
      bundleId: 'chat.mindroom.desktophelper',
      teamId: 'DNA6966LGZ',
    });
    expect(pin.sha256).not.toBe(PENDING_SHA256);
    expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['invalid repo', { repo: 'not-a-repo' }],
    ['empty tag', { tag: '' }],
    ['uppercase sha256', { sha256: 'A'.repeat(64) }],
    ['short sha256', { sha256: 'deadbeef' }],
    ['invalid teamId', { teamId: 'bad' }],
  ])('readHelperPin rejects %s', (_label, overrides) => {
    const dir = makeTempDir('mindroom-helper-pin-');
    const pinPath = writePin(dir, overrides);
    expect(() => readHelperPin(pinPath)).toThrow();
  });

  it('verifyTarballSha256 rejects all-zero sentinel and mismatched digests', () => {
    const dir = makeTempDir('mindroom-helper-sha-');
    const file = join(dir, 'sample.tar.gz');
    writeFileSync(file, 'payload');
    const realHash = createHash('sha256').update('payload').digest('hex');

    expect(() => verifyTarballSha256(file, PENDING_SHA256)).toThrow(/pending|sentinel|zero/i);
    expect(() => verifyTarballSha256(file, 'b'.repeat(64))).toThrow(/SHA-256 mismatch/);
    expect(verifyTarballSha256(file, realHash)).toBe(realHash);
  });

  it('rejects all-zero sentinel in download mode before invoking downloadTarball', async () => {
    const dir = makeTempDir('mindroom-helper-sentinel-');
    const pinPath = writePin(dir, { sha256: PENDING_SHA256 });
    const outDir = join(dir, 'out', HELPER_BUNDLE_NAME);
    let downloaded = false;

    await expect(
      fetchDesktopHelper({
        pinPath,
        outDir,
        localAppPath: '',
        downloadTarball: async () => {
          downloaded = true;
        },
      })
    ).rejects.toThrow(/pending|sentinel|zero/i);

    expect(downloaded).toBe(false);
    expect(existsSync(outDir)).toBe(false);
  });

  it('fails closed on SHA-256 mismatch and leaves an existing outDir untouched', async () => {
    const dir = makeTempDir('mindroom-helper-mismatch-');
    const { tarball } = createHelperTarball(dir, 'new-bin');
    const pinPath = writePin(dir, { sha256: 'f'.repeat(64) });
    const outDir = join(dir, 'out', HELPER_BUNDLE_NAME);
    createFakeHelperBundle(outDir, 'existing-bin');

    await expect(
      fetchDesktopHelper({
        pinPath,
        outDir,
        localAppPath: '',
        downloadTarball: async (_url: string, destPath: string) => {
          copyFileSync(tarball, destPath);
        },
      })
    ).rejects.toThrow(/SHA-256 mismatch/);

    expect(readFileSync(join(outDir, HELPER_EXEC_REL), 'utf8')).toBe('existing-bin');
  });

  it('downloads, verifies SHA-256, extracts preserving symlinks, and atomically replaces outDir', async () => {
    const dir = makeTempDir('mindroom-helper-ok-');
    const { tarball, sha256 } = createHelperTarball(dir, 'verified-bin');
    const pinPath = writePin(dir, { sha256 });
    const outParent = join(dir, 'out');
    const outDir = join(outParent, HELPER_BUNDLE_NAME);
    createFakeHelperBundle(outDir, 'stale-bin');
    writeFileSync(join(outDir, 'stale.txt'), 'remove-me');
    const seenUrls: string[] = [];

    await fetchDesktopHelper({
      pinPath,
      outDir,
      localAppPath: '',
      downloadTarball: async (url: string, destPath: string) => {
        seenUrls.push(url);
        copyFileSync(tarball, destPath);
      },
    });

    expect(seenUrls).toEqual([
      'https://github.com/mindroom-ai/mindroom/releases/download/v2026.11.568/MindRoom-Desktop-Helper-arm64.tar.gz',
    ]);
    expect(existsSync(join(outDir, 'stale.txt'))).toBe(false);
    expect(readFileSync(join(outDir, HELPER_EXEC_REL), 'utf8')).toBe('verified-bin');
    expect(statSync(join(outDir, HELPER_EXEC_REL)).mode & 0o111).not.toBe(0);
    const linkPath = join(outDir, 'Contents', 'Frameworks', 'Current');
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe('Versions/3.12');
    expect(readdirSync(outParent)).toEqual([HELPER_BUNDLE_NAME]);
  });

  it('fails closed when tarball does not contain the helper executable', async () => {
    const dir = makeTempDir('mindroom-helper-badtar-');
    const stage = join(dir, 'bad-src');
    mkdirSync(join(stage, HELPER_BUNDLE_NAME), { recursive: true });
    writeFileSync(join(stage, HELPER_BUNDLE_NAME, 'README.txt'), 'no binary');
    const tarball = join(dir, 'bad.tar.gz');
    const tar = spawnSync('tar', ['-czf', tarball, '-C', stage, HELPER_BUNDLE_NAME], {
      encoding: 'utf8',
    });
    expect(tar.status, tar.stderr).toBe(0);
    const sha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex');
    const pinPath = writePin(dir, { sha256 });
    const outDir = join(dir, 'out', HELPER_BUNDLE_NAME);

    await expect(
      fetchDesktopHelper({
        pinPath,
        outDir,
        localAppPath: '',
        downloadTarball: async (_url: string, destPath: string) => {
          copyFileSync(tarball, destPath);
        },
      })
    ).rejects.toThrow(/MindRoom Desktop Helper/);
    expect(existsSync(outDir)).toBe(false);
  });

  it('copies --local-app preserving symlinks even when pin has pending sentinel', async () => {
    const dir = makeTempDir('mindroom-helper-local-');
    const pinPath = writePin(dir, { sha256: PENDING_SHA256 });
    const localApp = join(dir, 'local', HELPER_BUNDLE_NAME);
    createFakeHelperBundle(localApp, 'local-dev-bin');
    const outDir = join(dir, 'out', HELPER_BUNDLE_NAME);

    await fetchDesktopHelper({ pinPath, outDir, localAppPath: localApp });

    expect(readFileSync(join(outDir, HELPER_EXEC_REL), 'utf8')).toBe('local-dev-bin');
    expect(lstatSync(join(outDir, 'Contents', 'Frameworks', 'Current')).isSymbolicLink()).toBe(
      true
    );

    const cliOut = join(dir, 'cli-out', HELPER_BUNDLE_NAME);
    const okCli = spawnSync(
      process.execPath,
      [
        resolve('scripts/fetch-desktop-helper.mjs'),
        '--pin',
        pinPath,
        '--out',
        cliOut,
        '--local-app',
        localApp,
      ],
      { encoding: 'utf8' }
    );
    expect(okCli.status, okCli.stderr).toBe(0);
    expect(readFileSync(join(cliOut, HELPER_EXEC_REL), 'utf8')).toBe('local-dev-bin');

    const failCli = spawnSync(
      process.execPath,
      [
        resolve('scripts/fetch-desktop-helper.mjs'),
        '--pin',
        pinPath,
        '--out',
        join(dir, 'fail-out'),
      ],
      { encoding: 'utf8', env: { ...process.env, MINDROOM_DESKTOP_HELPER_APP: '' } }
    );
    expect(failCli.status).not.toBe(0);
    expect(failCli.stderr).toMatch(/pending|sentinel|zero/i);
  });
});

describe('scripts/build-desktop-app.sh fail-closed checks', () => {
  type Cmd = { cmd: string; hasNotary: boolean; cscName: string; sign: string; args: string };

  const FAKE_BIN = `#!/usr/bin/env bash
set -eu
cmd=$(basename "$0"); target=""; for a in "$@"; do target="$a"; done
fail="\${TEST_FAIL:-}"; has_notary=0
if [[ -n "\${APPLE_ID:-}\${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then has_notary=1; fi
printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$cmd" "$has_notary" "\${CSC_NAME:-}" "\${MINDROOM_DESKTOP_SIGN:-}" "$*" >> "$TEST_LOG"
case "$cmd" in
  npx)
    if [[ "\${1:-}" == "electron-builder" ]]; then
      mkdir -p build/desktop-dist
      for f in MindRoom-Chat.dmg MindRoom-Chat-arm64-mac.zip MindRoom-Chat-x64-mac.zip MindRoom-Chat-arm64-mac.zip.blockmap MindRoom-Chat-x64-mac.zip.blockmap; do
        printf 'fake-%s' "$f" > "build/desktop-dist/$f"
      done
    fi ;;
  swiftc) printf 'fake-swift-bin' > "$target" ;;
  lipo) printf 'fake-universal-helper' > "$target" ;;
  ditto)
    mkdir -p "$target/MindRoom Chat.app/Contents/Resources"
    if [[ "$fail" != "helper:missing" ]]; then
      printf 'fake-helper' > "$target/MindRoom Chat.app/Contents/Resources/mindroom-screenshot-helper"
    fi
    if [[ "$target" == */arm64 && "$fail" != "desktop-helper:missing" ]]; then
      mkdir -p "$target/MindRoom Chat.app/Contents/Helpers/MindRoom Desktop Helper.app/Contents/MacOS"
      printf 'fake-desktop-helper' > "$target/MindRoom Chat.app/Contents/Helpers/MindRoom Desktop Helper.app/Contents/MacOS/MindRoom Desktop Helper"
    fi
    if [[ "$target" == */x64 && "$fail" == "desktop-helper:x64-present" ]]; then
      mkdir -p "$target/MindRoom Chat.app/Contents/Helpers/MindRoom Desktop Helper.app/Contents/MacOS"
      printf 'unexpected-x64-helper' > "$target/MindRoom Chat.app/Contents/Helpers/MindRoom Desktop Helper.app/Contents/MacOS/MindRoom Desktop Helper"
    fi ;;
  codesign)
    if [[ "\${1:-}" == "--verify" ]] && {
      [[ "$fail" == "codesign:app" && "$target" == *"MindRoom Chat.app" ]] ||
      [[ "$fail" == "codesign:helper" && "$target" == */mindroom-screenshot-helper ]] ||
      [[ "$fail" == "codesign:desktop-helper" && "$target" == *"MindRoom Desktop Helper.app" ]];
    }; then exit 1; fi
    if [[ "\${1:-}" == "-dv" ]]; then
      flags="0x0(none)"
      authority="\${TEST_AUTHORITY:-Developer ID Application: MindRoom AI (DNA6966LGZ)}"
      team="\${TEST_TEAM:-DNA6966LGZ}"
      identifier="chat.mindroom.app"
      if [[ "$target" == *"MindRoom Chat.app" ]]; then flags="\${TEST_FLAGS:-0x10000(runtime)}"; fi
      if [[ "$target" == */mindroom-screenshot-helper ]]; then flags="\${TEST_HELPER_FLAGS:-\${TEST_FLAGS:-0x10000(runtime)}}"; fi
      if [[ "$target" == *"MindRoom Desktop Helper.app" ]]; then
        flags="\${TEST_DESKTOP_HELPER_FLAGS:-\${TEST_FLAGS:-0x10000(runtime)}}"
        authority="\${TEST_DESKTOP_HELPER_AUTHORITY:-$authority}"
        team="\${TEST_DESKTOP_HELPER_TEAM:-$team}"
        identifier="\${TEST_DESKTOP_HELPER_ID:-chat.mindroom.desktophelper}"
      fi
      printf 'Identifier=%s\\nAuthority=%s\\nTeamIdentifier=%s\\nCodeDirectory v=20500 size=100 flags=%s\\n' \\
        "$identifier" "$authority" "$team" "$flags" >&2
    fi ;;
  xcrun)
    if [[ "\${1:-}" == "--sdk" && "\${2:-}" == "macosx" && "\${3:-}" == "--show-sdk-path" ]]; then
      printf '%s\\n' "/Fake/MacOSX.sdk"
    elif [[ "\${1:-}" == "--sdk" && "\${2:-}" == "macosx" && "\${3:-}" == "swiftc" ]]; then
      printf 'fake-swift-bin' > "$target"
    elif [[ "\${1:-}" == "stapler" && "\${2:-}" == "validate" ]] && { [[ "$fail" == "stapler:dmg" && "$target" == *.dmg ]] || [[ "$fail" == "stapler:app" && "$target" == *.app ]]; }; then
      exit 65
    fi ;;
  spctl) if [[ "$fail" == "spctl:dmg" && "$target" == *.dmg ]] || [[ "$fail" == "spctl:app" && "$target" == *.app ]]; then exit 3; fi ;;
esac
`;

  const FAKE_FETCH_HELPER = `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const hasNotary = process.env.APPLE_ID || process.env.APPLE_APP_SPECIFIC_PASSWORD ? '1' : '0';
appendFileSync(
  process.env.TEST_LOG,
  \`fetch-desktop-helper\\t\${hasNotary}\\t\${process.env.CSC_NAME ?? ''}\\t\${process.env.MINDROOM_DESKTOP_SIGN ?? ''}\\t\${args.join(' ')}\\n\`
);
if (process.env.TEST_FAIL === 'desktop-helper:fetch') {
  console.error('simulated fetch failure');
  process.exit(1);
}
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? args[outIndex + 1] : 'build/electron/MindRoom Desktop Helper.app';
mkdirSync(path.join(outDir, 'Contents', 'MacOS'), { recursive: true });
writeFileSync(path.join(outDir, 'Contents', 'MacOS', 'MindRoom Desktop Helper'), 'fake-fetched-helper');
`;

  function createFixture() {
    const root = makeTempDir('mindroom-desktop-build-');
    for (const file of ['scripts/build-desktop-app.sh', 'scripts/desktop-latest-yml.mjs']) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      copyFileSync(resolve(file), join(root, file));
    }
    writeFileSync(join(root, 'scripts/fetch-desktop-helper.mjs'), FAKE_FETCH_HELPER, 'utf8');
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'));
    mkdirSync(join(root, 'bin'));
    for (const tool of ['npm', 'npx', 'codesign', 'xcrun', 'spctl', 'ditto', 'swiftc', 'lipo']) {
      writeFileSync(join(root, 'bin', tool), FAKE_BIN, { mode: 0o755 });
    }
    const logFile = join(root, 'commands.tsv');
    const dir = join(root, 'artifacts');
    mkdirSync(dir);
    const [dmg, arm64, x64] = [
      'MindRoom-Chat.dmg',
      'MindRoom-Chat-arm64-mac.zip',
      'MindRoom-Chat-x64-mac.zip',
    ].map((name) => {
      const p = join(dir, name);
      writeFileSync(p, 'bytes');
      return p;
    }) as [string, string, string];

    const run = (args: string[], envOverrides: Record<string, string> = {}) => {
      const bashBin = process.platform === 'darwin' ? '/bin/bash' : 'bash';
      const res = spawnSync(bashBin, [join(root, 'scripts/build-desktop-app.sh'), ...args], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          NODE_PATH: resolve('node_modules'),
          TEST_LOG: logFile,
          MINDROOM_DESKTOP_HELPER_APP: '',
          CODESIGN_IDENTITY: 'Developer ID Application: MindRoom AI (DNA6966LGZ)',
          APPLE_ID: 'release@mindroom.chat',
          APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
          APPLE_TEAM_ID: 'DNA6966LGZ',
          MARKETING_VERSION: '2026.11.9',
          GITHUB_REPOSITORY: 'mindroom-ai/mindroom-chat',
          ...envOverrides,
        },
      });
      const commands: Cmd[] = existsSync(logFile)
        ? readFileSync(logFile, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const [cmd = '', hasNotary = '0', cscName = '', sign = '', rawArgs = ''] =
                line.split('\t');
              return { cmd, hasNotary: hasNotary === '1', cscName, sign, args: rawArgs };
            })
        : [];
      return { ...res, commands };
    };
    return { root, verifyArgs: ['--verify-only', dmg, arm64, x64], dmg, run };
  }

  it.each([
    ['missing APPLE_ID', { APPLE_ID: '' }, 'APPLE_ID'],
    [
      'missing APPLE_APP_SPECIFIC_PASSWORD',
      { APPLE_APP_SPECIFIC_PASSWORD: '' },
      'APPLE_APP_SPECIFIC_PASSWORD',
    ],
    ['missing APPLE_TEAM_ID', { APPLE_TEAM_ID: '' }, 'APPLE_TEAM_ID'],
    ['wrong team', { APPLE_TEAM_ID: 'WRONGTEAM1' }, 'DNA6966LGZ'],
    ['wrong identity', { CODESIGN_IDENTITY: 'Mac Developer: Someone (DNA6966LGZ)' }, 'DNA6966LGZ'],
    ['leading-v version', { MARKETING_VERSION: 'v2026.11.9' }, 'MARKETING_VERSION'],
    [
      'local desktop helper override',
      { MINDROOM_DESKTOP_HELPER_APP: '/tmp/local.app' },
      'MINDROOM_DESKTOP_HELPER_APP',
    ],
  ])('fails closed before building when --sign has %s', (_label, overrides, expectedErr) => {
    const res = createFixture().run(['--sign'], overrides);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain(expectedErr);
    expect(res.commands).toEqual([]);
  });

  it('--verify-only passes valid artifacts and never runs spctl on .zip files', () => {
    const { verifyArgs, dmg, run } = createFixture();
    const res = run(verifyArgs);
    expect(res.status, res.stderr).toBe(0);
    const spctl = res.commands.filter((c) => c.cmd === 'spctl');
    expect(spctl).toHaveLength(3);
    expect(spctl[0]?.args).toBe(`--assess --type open --context context:primary-signature ${dmg}`);
    expect(
      spctl
        .slice(1)
        .every(
          (c) =>
            c.args.startsWith('--assess --type execute ') && c.args.endsWith('/MindRoom Chat.app')
        )
    ).toBe(true);
    expect(spctl.some((c) => c.args.includes('.zip'))).toBe(false);
    const desktopHelperChecks = res.commands.filter(
      (c) =>
        c.cmd === 'codesign' &&
        c.args.startsWith('--verify --deep --strict ') &&
        c.args.endsWith('/Contents/Helpers/MindRoom Desktop Helper.app')
    );
    expect(desktopHelperChecks).toHaveLength(1);
    expect(desktopHelperChecks[0]?.args).toContain('/arm64/MindRoom Chat.app/');
  }, 15_000);

  it.each([
    ['unstapled DMG', { TEST_FAIL: 'stapler:dmg' }],
    ['unstapled unpacked app', { TEST_FAIL: 'stapler:app' }],
    ['wrong TeamIdentifier', { TEST_TEAM: 'OTHERTEAM1' }],
    ['wrong Authority', { TEST_AUTHORITY: 'Apple Development: Dev (DNA6966LGZ)' }],
    ['missing hardened runtime on app', { TEST_FLAGS: '0x0(none)' }],
    ['failed spctl on DMG', { TEST_FAIL: 'spctl:dmg' }],
    ['failed spctl on unpacked app', { TEST_FAIL: 'spctl:app' }],
    ['failed codesign on app', { TEST_FAIL: 'codesign:app' }],
    ['missing screenshot helper', { TEST_FAIL: 'helper:missing' }],
    ['failed codesign on screenshot helper', { TEST_FAIL: 'codesign:helper' }],
    ['missing hardened runtime on screenshot helper', { TEST_HELPER_FLAGS: '0x0(none)' }],
    ['missing arm64 desktop helper', { TEST_FAIL: 'desktop-helper:missing' }],
    ['unexpected desktop helper in x64 app', { TEST_FAIL: 'desktop-helper:x64-present' }],
    ['failed codesign on desktop helper', { TEST_FAIL: 'codesign:desktop-helper' }],
    ['wrong Identifier on desktop helper', { TEST_DESKTOP_HELPER_ID: 'chat.mindroom.wrong' }],
    ['wrong TeamIdentifier on desktop helper', { TEST_DESKTOP_HELPER_TEAM: 'OTHERTEAM1' }],
    ['missing hardened runtime on desktop helper', { TEST_DESKTOP_HELPER_FLAGS: '0x0(none)' }],
  ])(
    '--verify-only fails closed on %s',
    (_label, overrides) => {
      const { verifyArgs, run } = createFixture();
      expect(run(verifyArgs, overrides).status).not.toBe(0);
    },
    15_000
  );

  it('--sign unsets notary creds before build/helper fetch, verifies fetched helper, and strips CSC_NAME prefix', () => {
    const { root, run } = createFixture();
    const res = run(['--sign']);
    expect(res.status, res.stderr).toBe(0);
    expect(res.commands.find((c) => c.cmd === 'npm')?.hasNotary).toBe(false);
    const fetchIdx = res.commands.findIndex((c) => c.cmd === 'fetch-desktop-helper');
    const stagedVerifyIdx = res.commands.findIndex(
      (c) =>
        c.cmd === 'codesign' &&
        c.args === '--verify --deep --strict build/electron/MindRoom Desktop Helper.app'
    );
    const builderIdx = res.commands.findIndex(
      (c) => c.cmd === 'npx' && c.args.startsWith('electron-builder')
    );
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(stagedVerifyIdx).toBeGreaterThan(fetchIdx);
    expect(builderIdx).toBeGreaterThan(stagedVerifyIdx);
    expect(res.commands[fetchIdx]).toMatchObject({
      hasNotary: false,
      args: '--out build/electron/MindRoom Desktop Helper.app',
    });
    expect(res.commands[stagedVerifyIdx]?.hasNotary).toBe(false);
    expect(
      res.commands.find((c) => c.cmd === 'xcrun' && c.args === '--sdk macosx --show-sdk-path')
    ).toMatchObject({
      hasNotary: false,
    });
    const swiftc = res.commands.filter(
      (c) => c.cmd === 'xcrun' && c.args.startsWith('--sdk macosx swiftc ')
    );
    expect(swiftc).toHaveLength(2);
    expect(swiftc.every((c) => !c.hasNotary)).toBe(true);
    expect(swiftc.every((c) => c.args.includes('-sdk /Fake/MacOSX.sdk'))).toBe(true);
    expect(swiftc.map((c) => c.args)).toEqual([
      expect.stringContaining('-target arm64-apple-macosx13.0 electron/native/helper.swift'),
      expect.stringContaining('-target x86_64-apple-macosx13.0 electron/native/helper.swift'),
    ]);
    expect(res.commands.find((c) => c.cmd === 'lipo')).toMatchObject({
      hasNotary: false,
      args: expect.stringContaining('-output build/electron/mindroom-screenshot-helper'),
    });
    expect(res.commands[builderIdx]).toMatchObject({
      sign: '1',
      hasNotary: true,
      cscName: 'MindRoom AI (DNA6966LGZ)',
    });
    const latest = parse(readFileSync(join(root, 'build/desktop-dist/latest-mac.yml'), 'utf8')) as {
      version: string;
      files: Array<{ url: string }>;
    };
    expect(latest.version).toBe('2026.11.9');
    expect(latest.files).toHaveLength(2);
  }, 20_000);

  it.each([
    ['fetch fails', { TEST_FAIL: 'desktop-helper:fetch' }],
    ['fetched helper fails codesign', { TEST_FAIL: 'codesign:desktop-helper' }],
    ['fetched helper has wrong Identifier', { TEST_DESKTOP_HELPER_ID: 'chat.mindroom.other' }],
  ])(
    '--sign fails closed before electron-builder when %s',
    (_label, overrides) => {
      const res = createFixture().run(['--sign'], overrides);
      expect(res.status).not.toBe(0);
      expect(
        res.commands.some((c) => c.cmd === 'npx' && c.args.startsWith('electron-builder'))
      ).toBe(false);
    },
    15_000
  );

  it('unsigned mode removes stale helper when MINDROOM_DESKTOP_HELPER_APP is unset and fetches when set', () => {
    const cleanFixture = createFixture();
    const staleHelper = join(cleanFixture.root, 'build/electron', HELPER_BUNDLE_NAME);
    createFakeHelperBundle(staleHelper, 'stale');
    const unsignedRes = cleanFixture.run([]);
    expect(unsignedRes.status, unsignedRes.stderr).toBe(0);
    expect(existsSync(staleHelper)).toBe(false);
    expect(unsignedRes.commands.some((c) => c.cmd === 'fetch-desktop-helper')).toBe(false);

    const localFixture = createFixture();
    const localRes = localFixture.run([], { MINDROOM_DESKTOP_HELPER_APP: '/tmp/dev-helper.app' });
    expect(localRes.status, localRes.stderr).toBe(0);
    expect(localRes.commands.some((c) => c.cmd === 'fetch-desktop-helper')).toBe(true);
    expect(existsSync(join(localFixture.root, 'build/electron', HELPER_BUNDLE_NAME))).toBe(true);
  }, 15_000);
});

describe('workflow wiring (desktop.yml, release.yml)', () => {
  type Step = {
    id?: string;
    if?: string;
    name?: string;
    run?: string;
    uses?: string;
    with?: Record<string, unknown>;
  };

  it('wires release.yml -> desktop.yml and pins desktop.yml release + feed guards', () => {
    const releaseText = read('.github/workflows/release.yml');
    const desktopText = read('.github/workflows/desktop.yml');

    const release = parse(releaseText) as { jobs: { macos: { uses: string; secrets: string } } };
    expect(release.jobs.macos).toMatchObject({
      uses: './.github/workflows/desktop.yml',
      secrets: 'inherit',
    });
    expect(releaseText).not.toContain('macos.yml');

    const desktop = parse(desktopText) as {
      on: { pull_request: { paths: string[] } };
      jobs: {
        e2e: { steps: Step[] };
        release: { if?: string; permissions?: Record<string, string>; steps: Step[] };
        feed: {
          needs?: string;
          if?: string;
          'runs-on'?: string;
          permissions?: Record<string, string>;
          concurrency?: { group: string; queue: string };
          steps: Step[];
        };
      };
    };
    expect(desktop.on.pull_request.paths).toEqual(
      expect.arrayContaining([
        'scripts/macos-publish-appcast.sh',
        'scripts/desktop-helper-pin.json',
        'scripts/fetch-desktop-helper.mjs',
        'electron/afterPack.cjs',
        'src/app/desktop-access/**',
        'src/app/navigation/desktopAccessModal.ts',
      ])
    );
    expect(desktop.jobs.release.permissions).toEqual({ contents: 'write' });
    expect(desktop.jobs.release.if).toBe(
      "github.event_name != 'pull_request' && (github.event_name != 'release' || !github.event.release.prerelease)"
    );
    expect(
      desktop.jobs.e2e.steps.find((s) => s.uses?.startsWith('actions/checkout'))?.with?.[
        'persist-credentials'
      ]
    ).toBe(false);
    expect(
      desktop.jobs.release.steps.find((s) => s.uses?.startsWith('actions/checkout'))?.with
    ).toEqual({
      ref: 'refs/tags/${{ env.RELEASE_TAG }}',
      'persist-credentials': false,
    });
    expect(desktop.jobs.release.steps.some((s) => s.run?.includes('homebrew-tap'))).toBe(false);
    const upload =
      desktop.jobs.release.steps.find((s) => s.name === 'Attach verified artifacts to the release')
        ?.run ?? '';
    expect(upload).toContain('build/desktop-dist/MindRoom-Chat-arm64-mac.zip.blockmap');
    expect(upload).toContain('build/desktop-dist/MindRoom-Chat-x64-mac.zip.blockmap');
    expect(upload).not.toContain('if [[ -f');
    expect(upload).not.toContain('--clobber');
    expect(desktop.jobs.feed).toMatchObject({
      needs: 'release',
      'runs-on': 'ubuntu-24.04',
      permissions: { contents: 'write' },
      concurrency: { group: 'mac-desktop-feed', queue: 'max' },
    });
    expect(desktop.jobs.feed.if).toContain("needs.release.result == 'success'");
    expect(
      desktop.jobs.feed.steps.find((s) => s.uses?.startsWith('actions/checkout'))?.with
    ).toEqual({
      ref: 'refs/tags/${{ env.RELEASE_TAG }}',
      'persist-credentials': false,
    });
    expect(desktop.jobs.feed.steps.find((s) => s.id === 'feed')?.run).toBe(
      'scripts/macos-publish-appcast.sh --desktop "$RELEASE_TAG"'
    );
    for (const name of ['Mint a token for the Homebrew tap', 'Ask the tap to update its cask']) {
      expect(desktop.jobs.feed.steps.find((s) => s.name === name)?.if).toBe(
        "steps.feed.outputs.published == 'true' && steps.newest.outputs.newest == 'true'"
      );
    }
    expect(desktopText).not.toContain('PROVISIONING_PROFILE');
    expect(desktopText).not.toContain('provisionprofile');
    expect(existsSync(resolve('.github/workflows/macos.yml'))).toBe(false);
  });
});
