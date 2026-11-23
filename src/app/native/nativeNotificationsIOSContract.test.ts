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
const credentialStoreSource = kitSource('NotificationCredentialStore');
const intentSource = kitSource('NotificationCommunicationIntent');
const interactionSource = kitSource('NotificationInteractionCoordinator');
const installMarkerSource = kitSource('NotificationInstallMarker');

describe('MindRoomNotificationsPlugin and NotificationService native contract', () => {
  it('registers MindRoomNotifications with its Capacitor methods only on iOS (not Mac Catalyst)', () => {
    expect(pluginSource).toContain('#if !targetEnvironment(macCatalyst)');
    expect(pluginSource).toContain('public let jsName = "MindRoomNotifications"');
    ['syncAccount', 'syncAvatars', 'clearAccount', 'clearAllAccounts'].forEach((method) => {
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

  it('enriches only a push whose mindroom_account is an account the app still shares', () => {
    // No guess of "the only account on the device" for a push that names none.
    expect(serviceSource).not.toContain('loadSingleAccount');
    expect(credentialStoreSource).not.toContain('loadSingleAccount');
    expect(serviceSource).toContain('let accountTag = payload.accountTag, !accountTag.isEmpty');
    // Once before the avatar is read, and again around the donation.
    expect(
      serviceSource.match(
        /KeychainNotificationCredentialStore\.shared\.load\(accountTag: accountTag\)/g
      )
    ).toHaveLength(2);
  });

  it('ignores a Keychain record that an earlier installation of the app left', () => {
    // The Keychain outlives the app; the marker in the App Group container does not.
    expect(installMarkerSource).toContain('.appendingPathComponent("Application Support"');
    expect(installMarkerSource).not.toContain('"Caches"');
    expect(credentialStoreSource).toMatch(
      /installMarker\.readInstallId\(\),\s*!current\.isEmpty,\s*record\.installId == current/
    );
    expect(credentialStoreSource).toContain('installMarker: NotificationInstallMarker.shared');
    // Only the app makes the marker, and no account is stored without one.
    expect(serviceSource).not.toContain('getOrCreateInstallId');
    expect(pluginSource).toMatch(
      /NotificationInstallMarker\.shared\.getOrCreateInstallId\(\) else \{\s*return call\.reject\(/
    );
  });

  it('fails a sync or a clear that the Keychain refused, so that it is tried again', () => {
    expect(pluginSource).toMatch(
      /guard coordinator\.saveAccount\([^{]*\) else \{\s*return call\.reject\("[^"]*", "KEYCHAIN_ERROR"\)/
    );
    ['clearAccount(accountTag: accountTag)', 'clearAllAccounts()'].forEach((clear) => {
      const start = pluginSource.indexOf(`if await coordinator.${clear} {`);
      expect(start).toBeGreaterThan(-1);
      expect(pluginSource.slice(start, start + 220)).toMatch(
        /call\.resolve\(\)\s*\} else \{\s*call\.reject\("[^"]*", "KEYCHAIN_ERROR"\)/
      );
    });
    expect(credentialStoreSource).toContain(
      'deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound'
    );
  });

  it('removes every account, and what Siri keeps of them, when asked to clear all', () => {
    expect(credentialStoreSource).toContain('public func removeAll() -> Bool');
    const removeAll = pluginSource.slice(
      pluginSource.indexOf('private func removeAllAccounts() -> Bool {'),
      pluginSource.indexOf('private func currentGeneration')
    );
    expect(removeAll).toContain('clearAllGeneration &+= 1');
    expect(removeAll).toContain('KeychainNotificationCredentialStore.shared.removeAll()');
    expect(removeAll).toContain('NotificationAvatarStore.shared.clearAll()');
    // The call answers only after the interactions are deleted too.
    expect(pluginSource).toMatch(
      /let removed = removeAllAccounts\(\)\s*try\? await INInteraction\.deleteAll\(\)\s*return removed/
    );
  });

  it('donates an interaction under its account, without the message text, and deletes it with the account', () => {
    expect(serviceSource).toContain('interaction.groupIdentifier = accountTag');
    expect(serviceSource).toContain('interaction.identifier = interactionId');
    expect(serviceSource).not.toContain('mutableContent.body,');
    expect(intentSource.match(/content: nil,/g)).toHaveLength(2);
    expect(intentSource).not.toMatch(/content: (?!nil)/);
    expect(pluginSource).toContain('import Intents');
    expect(pluginSource).toMatch(
      /let removed = removeAccount\(accountTag\)[^}]*try\? await INInteraction\.delete\(with: accountTag\)\s*return removed/
    );
  });

  it('takes back a donation whose account went away while it was made', () => {
    expect(serviceSource).toContain('NotificationInteractionCoordinator.donateIfValid(');
    expect(serviceSource).toContain('try? await INInteraction.delete(with: [interactionId])');
    // The account is looked at before and after the donation, by its install and its sync.
    expect(interactionSource.match(/guard isAccountStillValid\(\) else/g)).toHaveLength(2);
    expect(serviceSource).toMatch(
      /account\.isSameSync\(\s*as: KeychainNotificationCredentialStore\.shared\.load\(accountTag: accountTag\)\s*\)/
    );
    // The cancellation of the task is looked at only after that cleanup, and nothing is shown
    // for a donation that was taken back.
    const afterDonation = serviceSource.slice(serviceSource.indexOf('let donated = await'));
    expect(afterDonation).toMatch(
      /\n {8}\)\n\n[^\n]*\n {8}guard !Task\.isCancelled else \{ return \}\n\n {8}guard donated, let updated = try\? mutableContent\.updating\(from: intent\) else \{\s*slot\.deliver\(mutableContent\)/
    );
  });

  it('shows a named room as a group of the sender and the user', () => {
    expect(serviceSource).toContain('NotificationCommunicationIntent.makeSendMessageIntent(');
    expect(serviceSource).toContain('accountUserId: account.userId');
    expect(intentSource).toContain('#if canImport(Intents)');
    expect(intentSource).toContain('recipients: [senderPerson, mePerson],');
    expect(intentSource).toContain('speakableGroupName: INSpeakableString(spokenPhrase:');
    expect(intentSource).toContain(
      'intent.setImage(avatarImage, forParameterNamed: \\.speakableGroupName)'
    );
    expect(intentSource).toContain('recipients: nil,');
  });

  it('asks for the sender avatar of the room of the notification, not of the profile', () => {
    expect(serviceSource).toMatch(
      /fetchSenderAvatar\([^)]*roomId: payload\.roomId,\s*sender: sender,\s*deadlineNanoseconds:/
    );
    expect(fetcherSource).toContain('/state/m.room.member/');
  });

  it('keeps avatars per room from the plugin call to the lookup for a notification', () => {
    expect(pluginSource).toContain('Self.trimmedNonEmpty(item["roomId"] as? String)');
    expect(pluginSource).toMatch(
      /storeAvatar\(\s*accountTag: accountTag,\s*roomId: entry\.roomId,/
    );
    expect(pluginSource).toMatch(
      /cachedMxcUrl\(\s*accountTag: accountTag,\s*roomId: entry\.roomId,/
    );
    expect(storeSource).toContain('sha256Hex("\\(room)\\0\\(sender)")');
    expect(serviceSource).toMatch(
      /cachedAvatar\(\s*accountTag: accountTag,\s*roomId: payload\.roomId,\s*sender: sender\s*\)/
    );
  });

  it('removes cached avatars that a sync no longer lists before it downloads any', () => {
    expect(storeSource).toContain('public func reconcileAccount(');
    // Each sync has a number of its own, so an earlier one stores nothing after it.
    const scheduleSync = pluginSource.slice(
      pluginSource.indexOf('func scheduleSync('),
      pluginSource.indexOf('func clearAccount(')
    );
    expect(scheduleSync).toMatch(
      /accountGenerations\[accountTag, default: 0\] &\+= 1\s*let generation = currentGeneration\(of: accountTag\)/
    );
    const sync = pluginSource.slice(pluginSource.indexOf('private func performAvatarSync('));
    expect(sync.indexOf('reconcileIfCurrent(')).toBeGreaterThan(-1);
    expect(sync.indexOf('reconcileIfCurrent(')).toBeLessThan(
      sync.indexOf('downloadAndStoreAvatar(')
    );
    expect(pluginSource).toContain('NotificationAvatarStore.shared.reconcileAccount(');
    expect(pluginSource).toContain('let mxcUrl = Self.trimmedNonEmpty(item["mxcUrl"] as? String)');
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
    // An image of several frames is never kept as it came.
    expect(storeSource).toMatch(
      /if CGImageSourceGetCount\(inspected\.source\) == 1,\s*max\(inspected\.width, inspected\.height\) <= maxStoredPixelSize\s*\{\s*return data/
    );
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
    expect(serviceSource).toContain('INInteraction(intent: intent, response: nil)');
    expect(serviceSource).toContain('interaction.direction = .incoming');
    expect(serviceSource).toContain('DeliverySlot');
    expect(serviceSource).not.toContain('NotificationAvatarStore.shared.storeAvatar');
    expect(serviceSource).toContain('mutableContent.updating(from: intent)');
    expect(serviceSource).toContain('serviceExtensionTimeWillExpire');
  });
});
