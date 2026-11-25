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
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

  it('pins names, hardened runtime, entitlements, fuses (+ resetAdHocDarwinSignature), and artifacts', () => {
    const rawConfig = read('electron/builder.config.cjs');
    const signed = loadBuilderConfig({
      MARKETING_VERSION: '2026.11.9',
      MINDROOM_DESKTOP_SIGN: '1',
    });
    const unsigned = loadBuilderConfig({ MARKETING_VERSION: '', MINDROOM_DESKTOP_SIGN: '0' });

    expect(signed).toMatchObject({
      appId: 'chat.mindroom.app',
      productName: 'MindRoom Chat',
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
      files: expect.arrayContaining([
        '!build/electron/mindroom-screenshot-helper',
        '!build/electron/mindroom-trackpad-swipe.node',
      ]),
      extraResources: [
        { from: 'build/electron/mindroom-screenshot-helper', to: 'mindroom-screenshot-helper' },
        { from: 'build/electron/mindroom-trackpad-swipe.node', to: 'mindroom-trackpad-swipe.node' },
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
        target: [
          { target: 'dmg', arch: ['universal'] },
          { target: 'zip', arch: ['arm64', 'x64'] },
        ],
      },
      dmg: { artifactName: 'MindRoom-Chat.dmg', title: 'MindRoom Chat', writeUpdateInfo: false },
    });

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
  lipo)
    if [[ "\${1:-}" == "-archs" ]]; then
      printf '%s\\n' "\${TEST_ADDON_ARCHS:-x86_64 arm64}"
    else
      printf 'fake-universal-bin' > "$target"
    fi ;;
  ditto)
    mkdir -p "$target/MindRoom Chat.app/Contents/Resources"
    if [[ "$fail" != "helper:missing" ]]; then
      printf 'fake-helper' > "$target/MindRoom Chat.app/Contents/Resources/mindroom-screenshot-helper"
    fi
    if [[ "$fail" != "addon:missing" ]]; then
      printf 'fake-addon' > "$target/MindRoom Chat.app/Contents/Resources/mindroom-trackpad-swipe.node"
    fi ;;
  codesign)
    if [[ "\${1:-}" == "--verify" ]] && {
      [[ "$fail" == "codesign:app" && "$target" == *.app ]] ||
      [[ "$fail" == "codesign:helper" && "$target" == */mindroom-screenshot-helper ]] ||
      [[ "$fail" == "codesign:addon" && "$target" == */mindroom-trackpad-swipe.node ]];
    }; then exit 1; fi
    if [[ "\${1:-}" == "-dv" ]]; then
      flags="0x0(none)"
      if [[ "$target" == *.app ]]; then flags="\${TEST_FLAGS:-0x10000(runtime)}"; fi
      if [[ "$target" == */mindroom-screenshot-helper ]]; then flags="\${TEST_HELPER_FLAGS:-\${TEST_FLAGS:-0x10000(runtime)}}"; fi
      printf 'Authority=%s\\nTeamIdentifier=%s\\nCodeDirectory v=20500 size=100 flags=%s\\n' \\
        "\${TEST_AUTHORITY:-Developer ID Application: MindRoom AI (DNA6966LGZ)}" "\${TEST_TEAM:-DNA6966LGZ}" "$flags" >&2
    fi ;;
  xcrun)
    if [[ "\${1:-}" == "--sdk" && "\${2:-}" == "macosx" && "\${3:-}" == "--show-sdk-path" ]]; then
      printf '%s\\n' "/Fake/MacOSX.sdk"
    elif [[ "\${1:-}" == "--sdk" && "\${2:-}" == "macosx" && "\${3:-}" == "swiftc" ]]; then
      printf 'fake-swift-bin' > "$target"
    elif [[ "\${1:-}" == "--sdk" && "\${2:-}" == "macosx" && "\${3:-}" == "clang++" ]]; then
      printf 'fake-clang-bundle' > "$target"
    elif [[ "\${1:-}" == "stapler" && "\${2:-}" == "validate" ]] && { [[ "$fail" == "stapler:dmg" && "$target" == *.dmg ]] || [[ "$fail" == "stapler:app" && "$target" == *.app ]]; }; then
      exit 65
    fi ;;
  spctl) if [[ "$fail" == "spctl:dmg" && "$target" == *.dmg ]] || [[ "$fail" == "spctl:app" && "$target" == *.app ]]; then exit 3; fi ;;
esac
`;

  function createFixture() {
    const root = mkdtempSync(join(tmpdir(), 'mindroom-desktop-build-'));
    tempDirs.push(root);
    for (const file of [
      'scripts/build-desktop-app.sh',
      'scripts/build-trackpad-swipe-addon.sh',
      'scripts/desktop-latest-yml.mjs',
    ]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      copyFileSync(resolve(file), join(root, file));
    }
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
    ['missing trackpad swipe addon', { TEST_FAIL: 'addon:missing' }],
    ['single-arch trackpad swipe addon', { TEST_ADDON_ARCHS: 'arm64' }],
    ['failed codesign on trackpad swipe addon', { TEST_FAIL: 'codesign:addon' }],
  ])(
    '--verify-only fails closed on %s',
    (_label, overrides) => {
      const { verifyArgs, run } = createFixture();
      expect(run(verifyArgs, overrides).status).not.toBe(0);
    },
    15_000
  );

  it('--sign unsets notary creds before npm build:desktop and strips CSC_NAME prefix', () => {
    const { root, run } = createFixture();
    const res = run(['--sign']);
    expect(res.status, res.stderr).toBe(0);
    expect(res.commands.find((c) => c.cmd === 'npm')?.hasNotary).toBe(false);
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
    const clang = res.commands.filter(
      (c) => c.cmd === 'xcrun' && c.args.startsWith('--sdk macosx clang++ ')
    );
    expect(clang).toHaveLength(2);
    expect(clang.every((c) => !c.hasNotary)).toBe(true);
    expect(clang.every((c) => c.args.includes('-isysroot /Fake/MacOSX.sdk'))).toBe(true);
    expect(clang.every((c) => c.args.includes('-DNAPI_VERSION=8'))).toBe(true);
    expect(clang.map((c) => c.args)).toEqual([
      expect.stringContaining('-target arm64-apple-macosx13.0 electron/native/trackpad_swipe.mm'),
      expect.stringContaining('-target x86_64-apple-macosx13.0 electron/native/trackpad_swipe.mm'),
    ]);
    const lipoCreates = res.commands.filter(
      (c) => c.cmd === 'lipo' && c.args.startsWith('-create ')
    );
    expect(lipoCreates).toEqual([
      expect.objectContaining({
        hasNotary: false,
        args: expect.stringContaining('-output build/electron/mindroom-screenshot-helper'),
      }),
      expect.objectContaining({
        hasNotary: false,
        args: expect.stringContaining('-output build/electron/mindroom-trackpad-swipe.node'),
      }),
    ]);
    expect(
      res.commands.find(
        (c) =>
          c.cmd === 'codesign' &&
          c.args === '--force --sign - build/electron/mindroom-trackpad-swipe.node'
      )
    ).toMatchObject({ hasNotary: false });
    expect(
      res.commands.find((c) => c.cmd === 'npx' && c.args.startsWith('electron-builder'))
    ).toMatchObject({
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
    expect(desktop.on.pull_request.paths).toContain('scripts/macos-publish-appcast.sh');
    expect(desktop.on.pull_request.paths).toContain('scripts/build-trackpad-swipe-addon.sh');
    expect(desktop.on.pull_request.paths).toContain('src/app/navigation/desktopHistorySwipe*');
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
