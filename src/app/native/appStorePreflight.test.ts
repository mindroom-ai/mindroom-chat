import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BROADCAST_EXTENSION_INFO_PLIST_PATH,
  NOTIFICATION_SERVICE_INFO_PLIST_PATH,
  WATCH_INFO_PLIST_PATH,
  XCODE_PROJECT_PATH,
  appStoreVersionProblems,
  broadcastExtensionUploadProblems,
  notificationServiceUploadProblems,
  watchAppUploadProblems,
} from '../../../scripts/appstore-preflight.mjs';
import { replaceAppTargetBuildSetting } from '../../../scripts/ios-xcode-project.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scriptPath = join(repoRoot, 'scripts/appstore-preflight.mjs');
const INFO_PLIST_PATH = 'ios/App/App/Info.plist';
const checkedInProject = readFileSync(join(repoRoot, XCODE_PROJECT_PATH), 'utf8');
const checkedInInfoPlist = readFileSync(join(repoRoot, INFO_PLIST_PATH), 'utf8');
const checkedInWatchInfoPlist = readFileSync(join(repoRoot, WATCH_INFO_PLIST_PATH), 'utf8');
const checkedInNotificationServiceInfoPlist = readFileSync(
  join(repoRoot, NOTIFICATION_SERVICE_INFO_PLIST_PATH),
  'utf8'
);
const checkedInBroadcastExtensionInfoPlist = readFileSync(
  join(repoRoot, BROADCAST_EXTENSION_INFO_PLIST_PATH),
  'utf8'
);

const project = (marketingVersion: string, buildNumber: string) =>
  replaceAppTargetBuildSetting(
    replaceAppTargetBuildSetting(checkedInProject, 'MARKETING_VERSION', marketingVersion),
    'CURRENT_PROJECT_VERSION',
    buildNumber
  );

const problems = (
  overrides: Partial<Parameters<typeof appStoreVersionProblems>[0]> = {}
): string[] =>
  appStoreVersionProblems({
    projectText: project('4.12.6', '33'),
    infoPlistText: checkedInInfoPlist,
    ...overrides,
  });

describe('appStoreVersionProblems', () => {
  it('accepts a three-integer marketing version, a calendar version among them, and a positive build', () => {
    expect(problems()).toEqual([]);
    expect(problems({ projectText: project('2026.11.0', '1') })).toEqual([]);
  });

  it.each(['4.12', '4.12.6-beta', '"4.12.x"'])('rejects the marketing version %s', (version) => {
    expect(problems({ projectText: project(version, '33') })).toEqual([
      expect.stringContaining("iOS MARKETING_VERSION must use Apple's three-integer format"),
    ]);
  });

  it.each(['0', '-1', '33.1', 'abc'])('rejects the build number %s', (buildNumber) => {
    expect(problems({ projectText: project('4.12.6', buildNumber) })).toEqual([
      `iOS CURRENT_PROJECT_VERSION must be a positive integer, got '${buildNumber}'.`,
    ]);
  });

  it('rejects build configurations that disagree', () => {
    const base = project('4.12.6', '33');
    const appEntitlementsIndex = base.indexOf('CODE_SIGN_ENTITLEMENTS = App/App.entitlements;');
    expect(appEntitlementsIndex).toBeGreaterThan(-1);
    const versionNeedle = 'CURRENT_PROJECT_VERSION = 33;';
    const versionIndex = base.indexOf(versionNeedle, appEntitlementsIndex);
    expect(versionIndex).toBeGreaterThan(appEntitlementsIndex);
    const mixed = `${base.slice(0, versionIndex)}CURRENT_PROJECT_VERSION = 34;${base.slice(
      versionIndex + versionNeedle.length
    )}`;
    expect(problems({ projectText: mixed })).toEqual([
      expect.stringContaining('CURRENT_PROJECT_VERSION of target App must have one value'),
    ]);
  });

  it('rejects an Info.plist that hard-codes the version', () => {
    const infoPlistText = checkedInInfoPlist.replace(
      '<string>$(MARKETING_VERSION)</string>',
      '<string>4.12.6</string>'
    );
    expect(problems({ infoPlistText })).toEqual([
      "Info.plist CFBundleShortVersionString must be $(MARKETING_VERSION), got '4.12.6'.",
    ]);
  });
});

describe('watchAppUploadProblems', () => {
  const watchProblems = (
    overrides: Partial<Parameters<typeof watchAppUploadProblems>[0]> = {}
  ): string[] =>
    watchAppUploadProblems({
      projectText: checkedInProject,
      watchInfoPlistText: checkedInWatchInfoPlist,
      ...overrides,
    });

  it('accepts the checked-in watch app', () => {
    expect(watchProblems()).toEqual([]);
  });

  it.each(['26.0', '"$(WATCH_MINIMUM)"'])(
    'rejects a watch target whose minimum watchOS is %s (ITMS-90733)',
    (minimum) => {
      const projectText = replaceAppTargetBuildSetting(
        checkedInProject,
        'WATCHOS_DEPLOYMENT_TARGET',
        minimum,
        'MindRoomWatchWidgets'
      );
      expect(watchProblems({ projectText })).toEqual([
        `Target MindRoomWatchWidgets is built without arm64_32, which App Store Connect takes only from watchOS 27.0 on, but its WATCHOS_DEPLOYMENT_TARGET is ${minimum.replace(
          /"/g,
          ''
        )}.`,
      ]);
    }
  );

  it('rejects WKBackgroundModes in the watch app (ITMS-90362), but not in a comment', () => {
    const key = '<key>UIBackgroundModes</key>';
    expect(
      watchProblems({
        watchInfoPlistText: checkedInWatchInfoPlist.replace(key, '<key>WKBackgroundModes</key>'),
      })
    ).toEqual([
      "The watch app's Info.plist has WKBackgroundModes, none of whose services the app uses; background audio is 'audio' in UIBackgroundModes.",
    ]);
    expect(
      watchProblems({
        watchInfoPlistText: checkedInWatchInfoPlist.replace(
          key,
          `<!-- <key>WKBackgroundModes</key> -->${key}`
        ),
      })
    ).toEqual([]);
  });
});

describe('notificationServiceUploadProblems', () => {
  const nseProblems = (
    overrides: Partial<Parameters<typeof notificationServiceUploadProblems>[0]> = {}
  ): string[] =>
    notificationServiceUploadProblems({
      projectText: checkedInProject,
      infoPlistText: checkedInInfoPlist,
      notificationServiceInfoPlistText: checkedInNotificationServiceInfoPlist,
      ...overrides,
    });

  it('accepts the checked-in Notification Service Extension', () => {
    expect(nseProblems()).toEqual([]);
  });

  it('rejects a version or build mismatch with App', () => {
    const mismatchedVersion = replaceAppTargetBuildSetting(
      checkedInProject,
      'MARKETING_VERSION',
      '9.9.9',
      'MindRoomNotificationService'
    );
    expect(nseProblems({ projectText: mismatchedVersion })).toEqual([
      expect.stringContaining('Target MindRoomNotificationService MARKETING_VERSION (9.9.9) must match App'),
    ]);

    const mismatchedBuild = replaceAppTargetBuildSetting(
      checkedInProject,
      'CURRENT_PROJECT_VERSION',
      '99999',
      'MindRoomNotificationService'
    );
    expect(nseProblems({ projectText: mismatchedBuild })).toEqual([
      expect.stringContaining('Target MindRoomNotificationService CURRENT_PROJECT_VERSION (99999) must match App'),
    ]);
  });

  it('rejects invalid extension Info.plist values and missing INSendMessageIntent in App Info.plist', () => {
    const badPlist = checkedInNotificationServiceInfoPlist
      .replace('<string>$(MARKETING_VERSION)</string>', '<string>1.0.0</string>')
      .replace('<string>com.apple.usernotifications.service</string>', '<string>com.apple.wrong</string>');
    expect(nseProblems({ notificationServiceInfoPlistText: badPlist })).toEqual([
      "MindRoomNotificationService Info.plist CFBundleShortVersionString must be $(MARKETING_VERSION), got '1.0.0'.",
      "MindRoomNotificationService Info.plist NSExtensionPointIdentifier must be com.apple.usernotifications.service, got 'com.apple.wrong'.",
    ]);

    const missingIntent = checkedInInfoPlist.replace('<string>INSendMessageIntent</string>', '');
    expect(nseProblems({ infoPlistText: missingIntent })).toEqual([
      'App Info.plist NSUserActivityTypes must include INSendMessageIntent for Communication Notifications.',
    ]);
  });
});

describe('broadcastExtensionUploadProblems', () => {
  const broadcastProblems = (
    overrides: Partial<Parameters<typeof broadcastExtensionUploadProblems>[0]> = {}
  ): string[] =>
    broadcastExtensionUploadProblems({
      projectText: checkedInProject,
      infoPlistText: checkedInInfoPlist,
      broadcastExtensionInfoPlistText: checkedInBroadcastExtensionInfoPlist,
      ...overrides,
    });

  it('accepts the Broadcast Upload Extension configuration', () => {
    expect(broadcastProblems()).toEqual([]);
  });

  it('rejects a version or build mismatch with App', () => {
    const mismatchedVersion = replaceAppTargetBuildSetting(
      checkedInProject,
      'MARKETING_VERSION',
      '9.9.9',
      'MindRoomBroadcast'
    );
    expect(broadcastProblems({ projectText: mismatchedVersion })).toEqual([
      expect.stringContaining('Target MindRoomBroadcast MARKETING_VERSION (9.9.9) must match App'),
    ]);

    const mismatchedBuild = replaceAppTargetBuildSetting(
      checkedInProject,
      'CURRENT_PROJECT_VERSION',
      '99999',
      'MindRoomBroadcast'
    );
    expect(broadcastProblems({ projectText: mismatchedBuild })).toEqual([
      expect.stringContaining(
        'Target MindRoomBroadcast CURRENT_PROJECT_VERSION (99999) must match App'
      ),
    ]);
  });

  it('rejects invalid extension Info.plist values and missing App Info.plist keys', () => {
    const badExtPlist = checkedInBroadcastExtensionInfoPlist
      .replace('<string>$(MARKETING_VERSION)</string>', '<string>1.0.0</string>')
      .replace('<string>com.apple.broadcast-services-upload</string>', '<string>com.apple.wrong</string>')
      .replace('<string>RPBroadcastProcessModeSampleBuffer</string>', '<string>WrongMode</string>')
      .replace('<string>group.chat.mindroom.app</string>', '<string>group.wrong</string>');
    expect(broadcastProblems({ broadcastExtensionInfoPlistText: badExtPlist })).toEqual([
      "MindRoomBroadcast Info.plist CFBundleShortVersionString must be $(MARKETING_VERSION), got '1.0.0'.",
      "MindRoomBroadcast Info.plist NSExtensionPointIdentifier must be com.apple.broadcast-services-upload, got 'com.apple.wrong'.",
      "MindRoomBroadcast Info.plist RPBroadcastProcessMode must be RPBroadcastProcessModeSampleBuffer, got 'WrongMode'.",
      "MindRoomBroadcast Info.plist RTCAppGroupIdentifier must be group.chat.mindroom.app, got 'group.wrong'.",
    ]);

    const badAppPlist = checkedInInfoPlist
      .replace('<string>group.chat.mindroom.app</string>', '<string>group.wrong</string>')
      .replace('<string>chat.mindroom.app.broadcast</string>', '');
    expect(broadcastProblems({ infoPlistText: badAppPlist })).toEqual([
      "App Info.plist RTCAppGroupIdentifier must be group.chat.mindroom.app, got 'group.wrong'.",
      "App Info.plist RTCScreenSharingExtension must be chat.mindroom.app.broadcast, got '(missing)'.",
    ]);
  });

  it('updates MindRoomBroadcast versions in ci_pre_xcodebuild.sh', () => {
    const ciPreXcodebuild = readFileSync(
      join(repoRoot, 'ios/App/ci_scripts/ci_pre_xcodebuild.sh'),
      'utf8'
    );
    const targetsMatch = ciPreXcodebuild.match(/const targets = \[([^\]]+)\];/);
    expect(targetsMatch?.[1]).toContain("'MindRoomBroadcast'");
  });
});

describe('appstore-preflight.mjs', () => {
  const checkouts: string[] = [];
  afterEach(() => {
    checkouts.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  });

  const checkout = (projectText: string) => {
    const root = mkdtempSync(join(tmpdir(), 'mindroom-appstore-preflight-'));
    checkouts.push(root);
    const files = {
      [XCODE_PROJECT_PATH]: projectText,
      [INFO_PLIST_PATH]: checkedInInfoPlist,
      [WATCH_INFO_PLIST_PATH]: checkedInWatchInfoPlist,
      [NOTIFICATION_SERVICE_INFO_PLIST_PATH]: checkedInNotificationServiceInfoPlist,
      [BROADCAST_EXTENSION_INFO_PLIST_PATH]: checkedInBroadcastExtensionInfoPlist,
    };
    Object.entries(files).forEach(([path, content]) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    });
    return root;
  };

  const run = (root: string) =>
    spawnSync(process.execPath, [scriptPath, root], { encoding: 'utf8' });

  it('passes the checked-in project of this repository', () => {
    const result = run(repoRoot);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^App Store preflight passed: iOS \d+\.\d+\.\d+ \(\d+\)/);
  });

  it('fails with the reason when the marketing version is not three integers', () => {
    const result = run(checkout(project('2026.11', '1')));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('App Store preflight failed:');
    expect(result.stderr).toContain(
      "iOS MARKETING_VERSION must use Apple's three-integer format, got '2026.11'."
    );
  });
});
