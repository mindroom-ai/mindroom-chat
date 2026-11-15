import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IOS_PUSH_CATEGORY } from '../notifications/push/iosPush';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const pluginSource = read('ios/App/App/MindRoomWatchPlugin.swift');
const bridgeSource = read('ios/App/App/MindRoomBridgeViewController.swift');
const sceneSource = read('ios/App/App/SceneDelegate.swift');
const infoPlist = read('ios/App/App/Info.plist');
const linkMessageSource = read(
  'ios/Watch/MindRoomWatchKit/Sources/MindRoomWatchKit/WatchLinkMessage.swift'
);

describe('MindRoomWatchPlugin native contract', () => {
  it('is the plugin the web side registers, with its methods, on every bridge', () => {
    expect(pluginSource).toContain('public let jsName = "MindRoomWatch"');
    ['status', 'sendCredentials', 'sendSecrets', 'signOut'].forEach((method) => {
      expect(pluginSource).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
      );
      expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
    });
    expect(bridgeSource).toContain('registerPluginInstance(MindRoomWatchPlugin())');
  });

  it('raises the events the web side listens for, kept until a listener reads them', () => {
    expect(pluginSource).toContain(
      'notifyListeners("watchSignedIn", data: device, retainUntilConsumed: true)'
    );
    expect(pluginSource).toContain(
      'notifyListeners("openThread", data: thread, retainUntilConsumed: true)'
    );
  });

  it('speaks the watch app’s link messages', () => {
    ['credentials', 'signedIn', 'secrets', 'signOut'].forEach((kind) => {
      expect(pluginSource).toContain(`"${kind}"`);
      expect(linkMessageSource).toContain(`"${kind}"`);
    });
    [
      'homeserverUrl',
      'userId',
      'loginToken',
      'expiresAt',
      'deviceId',
      'deviceKey',
      'bundle',
    ].forEach((key) => expect(linkMessageSource).toContain(`"${key}"`));
    // The device the watch names carries its signing key, which the web side checks before verifying.
    expect(pluginSource).toContain('let deviceKey = message["deviceKey"] as? String');
  });

  it('takes the watch’s Handoff in the main scene, as a declared activity type', () => {
    expect(pluginSource).toContain('static let activityType = "chat.mindroom.open-thread"');
    expect(infoPlist).toContain('<string>chat.mindroom.open-thread</string>');
    expect(sceneSource).toContain('if WatchHandoff.receive(userActivity) { return }');
    expect(sceneSource).toContain(
      'connectionOptions.userActivities.forEach { _ = WatchHandoff.receive($0) }'
    );
  });

  it('names the push category the watch app shows its long look for', () => {
    expect(IOS_PUSH_CATEGORY).toBe('MINDROOM_EVENT');
  });
});
