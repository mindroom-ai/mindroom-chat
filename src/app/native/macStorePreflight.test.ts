import { describe, expect, it } from 'vitest';
import {
  macStoreArchitectureProblems,
  macStoreEntitlementProblems,
  macStoreMetadataProblems,
  macStoreUpdaterProblems,
} from '../../../scripts/macos-store-preflight.mjs';

const metadata = () => ({
  app: {
    CFBundleIdentifier: 'chat.mindroom.app',
    CFBundleShortVersionString: '2026.11.225',
    CFBundleVersion: '809',
    CFBundleSupportedPlatforms: ['MacOSX'],
    LSApplicationCategoryType: 'public.app-category.productivity',
    NSHumanReadableCopyright: '2026 Bas Nijholt',
    ITSAppUsesNonExemptEncryption: false,
  },
  support: {
    CFBundleIdentifier: 'chat.mindroom.app.mac-support',
    CFBundleShortVersionString: '2026.11.225',
    CFBundleVersion: '809',
  },
  web: { version: '1111111111111111111111111111111111111111', release: 'v2026.11.225' },
  version: '2026.11.225',
  build: '809',
  commit: '1111111111111111111111111111111111111111',
});

const entitlements = () => ({
  'com.apple.security.app-sandbox': true,
  'com.apple.security.network.client': true,
  'com.apple.security.device.microphone': true,
  'com.apple.security.device.audio-input': true,
  'com.apple.security.device.camera': true,
  'com.apple.security.files.user-selected.read-write': true,
  'com.apple.developer.aps-environment': 'production',
  'com.apple.developer.associated-domains': ['applinks:chat.mindroom.chat'],
});

describe('Mac Store emitted-artifact preflight', () => {
  it('rejects any trace of the updater', () => {
    expect(
      macStoreUpdaterProblems({
        // The web bundle carries every license text, Sparkle's too.
        paths: [
          'Contents/MacOS/MindRoom.chat',
          'Contents/Resources/public/public/licenses/Sparkle-MIT.txt',
        ],
        infoKeys: ['CFBundleName', 'SUPPORTED'],
        strings: ['uiWindow'],
      })
    ).toEqual([]);
    expect(
      macStoreUpdaterProblems({
        paths: [
          'Contents/PlugIns/MindRoomMacUpdater.bundle/Contents/Frameworks/Sparkle.framework/Sparkle',
        ],
        infoKeys: ['SUFeedURL'],
        strings: ['SPUUpdater'],
      })
    ).toHaveLength(3);
  });

  it('accepts matching app, native support and web source metadata', () => {
    expect(macStoreMetadataProblems(metadata())).toEqual([]);
  });

  it.each(['app', 'support'] as const)('rejects a stale %s bundle build number', (bundle) => {
    const input = metadata();
    input[bundle].CFBundleVersion = '808';
    expect(macStoreMetadataProblems(input).join('\n')).toContain('CFBundleVersion');
  });

  it.each(['app', 'support'] as const)('rejects a mismatched %s version', (bundle) => {
    const input = metadata();
    input[bundle].CFBundleShortVersionString = '2026.11.224';
    expect(macStoreMetadataProblems(input).join('\n')).toContain('CFBundleShortVersionString');
  });

  it('rejects web content from a different source commit or release', () => {
    const input = metadata();
    input.web.version = '2222222222222222222222222222222222222222';
    input.web.release = 'v2026.11.224';
    const problems = macStoreMetadataProblems(input).join('\n');
    expect(problems).toContain('commit');
    expect(problems).toContain('release');
  });

  it('accepts web content of the candidate commit built with client plugins', () => {
    const input = metadata();
    input.web.version = `${input.commit}-plugins-0123456789abcdef`;
    expect(macStoreMetadataProblems(input)).toEqual([]);
    input.web.version = '2222222222222222222222222222222222222222-plugins-0123456789abcdef';
    expect(macStoreMetadataProblems(input).join('\n')).toContain('commit');
  });

  it('rejects an iOS package and missing Mac bundle metadata', () => {
    const input = metadata();
    input.app.CFBundleSupportedPlatforms = ['iPhoneOS'];
    input.app.LSApplicationCategoryType = '';
    input.app.NSHumanReadableCopyright = '';
    const problems = macStoreMetadataProblems(input).join('\n');
    ['MacOSX', 'LSApplicationCategoryType', 'NSHumanReadableCopyright'].forEach((key) =>
      expect(problems).toContain(key)
    );
  });

  it.each(['0', '1.2.3', '-1', ''])('rejects invalid Store build input %j', (build) => {
    expect(macStoreMetadataProblems({ ...metadata(), build }).join('\n')).toContain('build');
  });

  it('accepts the required signed sandbox capabilities', () => {
    expect(macStoreEntitlementProblems(entitlements(), 'DNA6966LGZ')).toEqual([]);
  });

  it.each([
    'com.apple.security.app-sandbox',
    'com.apple.security.network.client',
    'com.apple.security.device.microphone',
    'com.apple.security.device.audio-input',
    'com.apple.security.device.camera',
    'com.apple.security.files.user-selected.read-write',
  ] as const)('rejects missing runtime access: %s', (key) => {
    const input = { ...entitlements(), [key]: false };
    expect(macStoreEntitlementProblems(input, 'DNA6966LGZ').join('\n')).toContain(key);
  });

  it('rejects development signing and a different team', () => {
    const input = { ...entitlements(), 'com.apple.security.get-task-allow': true };
    input['com.apple.developer.aps-environment'] = 'development';
    const problems = macStoreEntitlementProblems(input, 'OTHERTEAM1').join('\n');
    ['team', 'get-task-allow', 'aps-environment'].forEach((key) => expect(problems).toContain(key));
  });

  it('requires native support for every app architecture', () => {
    expect(macStoreArchitectureProblems(['arm64', 'x86_64'], ['arm64', 'x86_64'])).toEqual([]);
    expect(macStoreArchitectureProblems(['arm64', 'x86_64'], ['arm64']).join('\n')).toContain(
      'x86_64'
    );
    expect(macStoreArchitectureProblems([], ['arm64']).join('\n')).toContain('architecture');
  });
});
