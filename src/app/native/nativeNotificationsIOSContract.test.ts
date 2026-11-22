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
const serviceInfoPlist = read('ios/NotificationService/MindRoomNotificationService/Info.plist');
const serviceEntitlements = read(
  'ios/NotificationService/MindRoomNotificationService/MindRoomNotificationService.entitlements'
);
const kitSource = (name: string) =>
  read(
    `ios/NotificationService/MindRoomNotificationKit/Sources/MindRoomNotificationKit/${name}.swift`
  );
const fetcherSource = kitSource('NotificationAvatarFetcher');
const storeSource = kitSource('NotificationAvatarStore');
const httpClientSource = kitSource('NotificationHTTPClient');

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

  it('turns the Capacitor bridge log off, which would print the access token of syncAccount in a Debug build', () => {
    // Capacitor logs every plugin call with its options unless the instance says otherwise.
    expect(bridgeSource).toMatch(
      /override func instanceDescriptor\(\) -> InstanceDescriptor \{[^}]*descriptor\.loggingBehavior = \.none\n\s*return descriptor/
    );
    expect(pluginSource).not.toMatch(/\b(print|NSLog|CAPLog\.print)\(/);
  });

  it('keeps avatars per room from the plugin call to the lookup for a notification', () => {
    expect(pluginSource).toContain('Self.trimmedNonEmpty(item["roomId"] as? String)');
    expect(pluginSource).toMatch(
      /storeAvatar\(\s*accountTag: accountTag,\s*roomId: entry\.roomId,/
    );
    expect(pluginSource).toMatch(
      /removeAvatar\(\s*accountTag: accountTag,\s*roomId: entry\.roomId,/
    );
    expect(pluginSource).toMatch(
      /cachedMxcUrl\(\s*accountTag: accountTag,\s*roomId: entry\.roomId,/
    );
    expect(storeSource).toContain('sha256Hex("\\(room)\\0\\(sender)")');
    expect(serviceSource).toMatch(
      /cachedAvatar\(\s*accountTag: accountTag,\s*roomId: payload\.roomId,\s*sender: sender\s*\)/
    );
  });

  it('holds a notification back no longer than 3 seconds for an avatar that is not cached', () => {
    expect(serviceSource).toContain(
      'private static let avatarFetchDeadlineNanoseconds: UInt64 = 3_000_000_000'
    );
    expect(serviceSource).toContain('deadlineNanoseconds: Self.avatarFetchDeadlineNanoseconds');
    // Every fetch of the extension goes through the deadline.
    expect(serviceSource.match(/fetchSenderAvatar\(/g)).toHaveLength(1);
    expect(fetcherSource).toContain('try? await Task.sleep(nanoseconds: deadlineNanoseconds)');
    expect(fetcherSource).toContain('group.cancelAll()');
  });

  it('bounds what the extension downloads and decodes', () => {
    expect(storeSource).toContain('public static let maxImageDimension = 2048');
    expect(storeSource).toContain('public static let maxImagePixels = 4_194_304');
    // The body is collected in the chunks the session delivers, never byte by byte.
    expect(fetcherSource).not.toContain('.bytes(for:');
    expect(httpClientSource).toContain('URLSessionDataDelegate');
  });

  it('configures Communication Notifications, App Group, and shared Keychain only on the right targets', () => {
    // Main iOS app entitlements
    expect(appEntitlements).toContain(
      '<key>com.apple.developer.usernotifications.communication</key>'
    );
    expect(appEntitlements).toContain('<string>group.chat.mindroom.app</string>');
    expect(appEntitlements).toContain('<string>$(AppIdentifierPrefix)chat.mindroom.app</string>');

    // Notification Service Extension entitlements: shared App Group + Keychain, NEVER communication entitlement
    expect(serviceEntitlements).toContain('<string>group.chat.mindroom.app</string>');
    expect(serviceEntitlements).toContain(
      '<string>$(AppIdentifierPrefix)chat.mindroom.app</string>'
    );
    expect(serviceEntitlements).not.toContain(
      'com.apple.developer.usernotifications.communication'
    );

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
    expect(serviceInfoPlist).toContain(
      '<string>$(PRODUCT_MODULE_NAME).NotificationService</string>'
    );
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
    expect(serviceSource).toContain('recipients: nil');
    expect(serviceSource).toContain('DeliverySlot');
    expect(serviceSource).not.toContain('NotificationAvatarStore.shared.storeAvatar');
    expect(serviceSource).toContain('mutableContent.updating(from: intent)');
    expect(serviceSource).toContain('serviceExtensionTimeWillExpire');
  });
});
