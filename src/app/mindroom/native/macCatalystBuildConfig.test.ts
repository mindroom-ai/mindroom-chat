import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSingleAppTargetBuildSettingValue } from '../../../../scripts/ios-xcode-project.mjs';

const require = createRequire(import.meta.url);
// Use the same parser as the declared Capacitor CLI dependency.
const requireCapacitor = createRequire(require.resolve('@capacitor/cli/package.json'));
const plist = requireCapacitor('plist');
const xcodeProject = readFileSync(resolve('ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
// Xcode quotes values that contain characters such as `-`.
const appSetting = (name: string) =>
  getSingleAppTargetBuildSettingValue(xcodeProject, name).replace(/^"|"$/g, '');

describe('Mac Catalyst build of the App target', () => {
  it('builds for Mac Catalyst under the iOS bundle ID', () => {
    expect(appSetting('SUPPORTS_MACCATALYST')).toBe('YES');
    // The Mac app shares push, universal links and Sign in with Apple with iOS.
    expect(appSetting('DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER')).toBe('NO');
    expect(appSetting('PRODUCT_BUNDLE_IDENTIFIER')).toBe('chat.mindroom.app');
  });

  it('signs the Mac build with its own entitlements and the hardened runtime', () => {
    expect(appSetting('"CODE_SIGN_ENTITLEMENTS[sdk=macosx*]"')).toBe('App/App-macOS.entitlements');
    // Notarization requires the hardened runtime.
    expect(appSetting('"ENABLE_HARDENED_RUNTIME[sdk=macosx*]"')).toBe('YES');
    expect(appSetting('CODE_SIGN_ENTITLEMENTS')).toBe('App/App.entitlements');
  });

  it('grants the Mac build push, pairing links, Sign in with Apple, microphone and camera', () => {
    const entitlements = plist.parse(
      readFileSync(resolve('ios/App/App/App-macOS.entitlements'), 'utf8')
    );
    expect(entitlements).toEqual({
      // development for Debug and production for Release, as App.entitlements does.
      'com.apple.developer.aps-environment': '$(APS_ENVIRONMENT)',
      'com.apple.developer.associated-domains': ['applinks:chat.mindroom.chat'],
      'com.apple.developer.applesignin': ['Default'],
      // The hardened runtime blocks the microphone and camera without these.
      'com.apple.security.device.audio-input': true,
      'com.apple.security.device.camera': true,
    });
  });
});
