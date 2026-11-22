import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const pluginSource = read('ios/App/App/MindRoomNotificationsPlugin.swift');
const bridgeSource = read('ios/App/App/MindRoomBridgeViewController.swift');
const appEntitlements = read('ios/App/App/App.entitlements');
const macEntitlements = read('ios/App/App/App-macOS.entitlements');
const macAppStoreEntitlements = read('ios/App/App/App-macOS-AppStore.entitlements');
const appInfoPlist = read('ios/App/App/Info.plist');
const serviceSource = read(
  'ios/NotificationService/MindRoomNotificationService/NotificationService.swift'
);
const serviceInfoPlist = read(
  'ios/NotificationService/MindRoomNotificationService/Info.plist'
);
const serviceEntitlements = read(
  'ios/NotificationService/MindRoomNotificationService/MindRoomNotificationService.entitlements'
);

describe('MindRoomNotificationsPlugin and NotificationService native contract', () => {
  it('registers MindRoomNotifications with its Capacitor methods only on iOS (not Mac Catalyst)', () => {
    expect(pluginSource).toContain('#if !targetEnvironment(macCatalyst)');
    expect(pluginSource).toContain('public let jsName = "MindRoomNotifications"');
    ['syncAccount', 'syncAvatars', 'clearAccount'].forEach((method) => {
      expect(pluginSource).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
      );
      expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
    });
    expect(bridgeSource).toContain('#if !targetEnvironment(macCatalyst)');
    expect(bridgeSource).toContain('registerPluginInstance(MindRoomNotificationsPlugin())');
  });

  it('configures Communication Notifications, App Group, and shared Keychain only on the right targets', () => {
    // Main iOS app entitlements
    expect(appEntitlements).toContain('<key>com.apple.developer.usernotifications.communication</key>');
    expect(appEntitlements).toContain('<string>group.chat.mindroom.app</string>');
    expect(appEntitlements).toContain('<string>$(AppIdentifierPrefix)chat.mindroom.app</string>');

    // Notification Service Extension entitlements: shared App Group + Keychain, NEVER communication entitlement
    expect(serviceEntitlements).toContain('<string>group.chat.mindroom.app</string>');
    expect(serviceEntitlements).toContain('<string>$(AppIdentifierPrefix)chat.mindroom.app</string>');
    expect(serviceEntitlements).not.toContain('com.apple.developer.usernotifications.communication');

    // Mac Catalyst entitlements stay untouched and free of iOS-only notification entitlements
    expect(macEntitlements).not.toContain('com.apple.developer.usernotifications.communication');
    expect(macEntitlements).not.toContain('group.chat.mindroom.app');
    expect(macAppStoreEntitlements).not.toContain(
      'com.apple.developer.usernotifications.communication'
    );
    expect(macAppStoreEntitlements).not.toContain('group.chat.mindroom.app');
  });

  it('declares INSendMessageIntent in App Info.plist and the notification service extension point in NSE Info.plist', () => {
    expect(appInfoPlist).toContain('<string>INSendMessageIntent</string>');
    expect(serviceInfoPlist).toContain('<string>com.apple.usernotifications.service</string>');
    expect(serviceInfoPlist).toContain('<string>$(PRODUCT_MODULE_NAME).NotificationService</string>');
    expect(serviceInfoPlist).toContain('<string>$(MARKETING_VERSION)</string>');
    expect(serviceInfoPlist).toContain('<string>$(CURRENT_PROJECT_VERSION)</string>');
  });

  it('implements Markdown stripping, ring bypass, Communication Notifications, and thread-safe expiration in NotificationService.swift', () => {
    expect(serviceSource).toContain('UNNotificationServiceExtension');
    expect(serviceSource).toContain('payload.isRing');
    expect(serviceSource).toContain('!payload.isGatewayFormatted');
    expect(serviceSource).toContain('NotificationMarkdown.strip');
    expect(serviceSource).toContain('INSendMessageIntent');
    expect(serviceSource).toContain('interaction.direction = .incoming');
    expect(serviceSource).toContain('mutableContent.updating(from: intent)');
    expect(serviceSource).toContain('serviceExtensionTimeWillExpire');
  });
});
