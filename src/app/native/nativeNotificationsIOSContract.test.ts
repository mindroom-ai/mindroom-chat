import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fileUrl = (path: string) => new URL(`../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(fileUrl(path), 'utf8');

const KIT_SOURCES =
  'ios/NotificationService/MindRoomNotificationKit/Sources/MindRoomNotificationKit';
const KIT_TESTS =
  'ios/NotificationService/MindRoomNotificationKit/Tests/MindRoomNotificationKitTests';

const pluginSource = read('ios/App/App/MindRoomNotificationsPlugin.swift');
const bridgeSource = read('ios/App/App/MindRoomBridgeViewController.swift');
const appEntitlements = read('ios/App/App/App.entitlements');
const appInfoPlist = read('ios/App/App/Info.plist');
const serviceSource = read(
  'ios/NotificationService/MindRoomNotificationService/NotificationService.swift'
);
const serviceInfoPlist = read('ios/NotificationService/MindRoomNotificationService/Info.plist');
const serviceEntitlements = read(
  'ios/NotificationService/MindRoomNotificationService/MindRoomNotificationService.entitlements'
);
const kitSource = (name: string) => read(`${KIT_SOURCES}/${name}.swift`);
const accountStoreSource = kitSource('NotificationAccountStore');
const avatarStoreSource = kitSource('NotificationAvatarStore');
const intentSource = kitSource('NotificationCommunicationIntent');
const interactionSource = kitSource('NotificationInteractionCoordinator');
const mutationQueueSource = kitSource('NotificationAccountMutationQueue');
/** Everything that runs for a notification or for a call of the plugin. */
const nativeSources = [
  pluginSource,
  serviceSource,
  accountStoreSource,
  avatarStoreSource,
  intentSource,
  interactionSource,
  mutationQueueSource,
  kitSource('NotificationMarkdown'),
  kitSource('NotificationPayload'),
];

/** The body of a Swift function, from its `func <name>(` to the next `func ` of its type. */
const functionBody = (source: string, name: string): string => {
  const start = source.indexOf(`func ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n    func ', start + 1);
  const nextAnnotated = source.indexOf('\n    @objc func ', start + 1);
  const nextPrivate = source.indexOf('\n    private ', start + 1);
  const nextPublic = source.indexOf('\n    public func ', start + 1);
  const ends = [end, nextAnnotated, nextPrivate, nextPublic].filter((index) => index > -1);
  return source.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
};

const PLUGIN_METHODS = [
  'syncAccount',
  'reconcileAccounts',
  'syncAvatars',
  'storeAvatar',
  'clearAvatarCache',
];

describe('MindRoomNotificationsPlugin and NotificationService native contract', () => {
  it('registers MindRoomNotifications with its Capacitor methods on iOS', () => {
    expect(pluginSource).toContain('public let jsName = "MindRoomNotifications"');
    PLUGIN_METHODS.forEach((method) => {
      expect(pluginSource).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
      );
      expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
    });
    expect(pluginSource.match(/CAPPluginMethod\(name:/g)).toHaveLength(PLUGIN_METHODS.length);
    expect(bridgeSource).toContain('registerPluginInstance(MindRoomNotificationsPlugin())');
  });

  it('keeps no secret, makes no request, and has no Keychain or install marker left', () => {
    [
      `${KIT_SOURCES}/NotificationCredentialStore.swift`,
      `${KIT_SOURCES}/NotificationInstallMarker.swift`,
      `${KIT_SOURCES}/NotificationHTTPClient.swift`,
      `${KIT_SOURCES}/NotificationAvatarFetcher.swift`,
      `${KIT_TESTS}/NotificationCredentialStoreTests.swift`,
      `${KIT_TESTS}/NotificationHTTPClientTests.swift`,
      `${KIT_TESTS}/NotificationAvatarFetcherTests.swift`,
    ].forEach((path) => expect(existsSync(fileUrl(path)), path).toBe(false));

    nativeSources.forEach((source) => {
      expect(source).not.toMatch(/URLSession|URLRequest|import Security|SecItem|kSec|Keychain/);
      expect(source).not.toMatch(/accessToken|access_token|homeserverUrl|Bearer/);
    });
    // No token crosses the bridge, so its log keeps Capacitor's default.
    expect(bridgeSource).not.toContain('loggingBehavior');
    expect(pluginSource).not.toMatch(/\b(print|NSLog|CAPLog\.print)\(/);
  });

  it('keeps the accounts where iOS deletes them with the app and does not empty them to make room', () => {
    expect(accountStoreSource).toContain('.appendingPathComponent("Application Support"');
    expect(accountStoreSource).toContain('"MindRoomNotifications"');
    expect(accountStoreSource).not.toContain('"Caches"');
    expect(accountStoreSource).toContain(
      'containerURL(forSecurityApplicationGroupIdentifier: NotificationAvatarStore.appGroupId)'
    );
    expect(accountStoreSource).toContain('appendingPathComponent("accounts", isDirectory: true)');
    expect(accountStoreSource).toContain('"pending-interaction-deletes.json"');
    // The avatars can be downloaded again, so they are a cache.
    expect(avatarStoreSource).toContain('.appendingPathComponent("Caches"');
    expect(avatarStoreSource).toContain('public static let appGroupId = "group.chat.mindroom.app"');
    // What is stored of an account: its tag, its user and its sync, nothing else.
    const metadata = accountStoreSource.slice(
      accountStoreSource.indexOf('public struct NotificationAccountMetadata'),
      accountStoreSource.indexOf('public init(accountTag: String, userId: String, syncId: String)')
    );
    expect(metadata.match(/public let \w+: String/g)).toEqual([
      'public let accountTag: String',
      'public let userId: String',
      'public let syncId: String',
    ]);
  });

  it('enriches only a push whose mindroom_account is an account the app still shares', () => {
    // No guess of "the only account on the device" for a push that names none.
    expect(serviceSource).not.toContain('allAccountTags');
    expect(serviceSource).toContain('let accountTag = payload.accountTag, !accountTag.isEmpty');
    // Once before the avatar is read, and again around the donation.
    expect(
      serviceSource.match(
        /NotificationAccountStore\.shared\.loadAccount\(accountTag: accountTag\)/g
      )
    ).toHaveLength(2);
    expect(serviceSource).toMatch(
      /guard let account = NotificationAccountStore\.shared\.loadAccount\(accountTag: accountTag\) else \{\s*slot\.deliver\(mutableContent\)\s*return/
    );
    // The extension writes no account and no avatar.
    expect(serviceSource).not.toMatch(
      /saveAccount|removeAccount|storeAvatar|clearAll|pruneAccounts/
    );
  });

  it('shows the avatar the app cached, and downloads none', () => {
    expect(serviceSource).toMatch(
      /let avatarData = NotificationAvatarStore\.shared\.cachedAvatar\(\s*accountTag: accountTag,\s*roomId: payload\.roomId,\s*sender: sender\s*\)/
    );
    expect(serviceSource).not.toMatch(/fetch|download|Deadline/i);
  });

  it('changes what the app shares one call at a time, in the order the web side asked', () => {
    // A place in the order is taken under the lock, before the call returns.
    expect(mutationQueueSource).toMatch(
      /lock\.lock\(\)\s*defer \{ lock\.unlock\(\) \}\s*let previous = last\s*let task = Task<Void, Never> \{\s*if let previous \{\s*await previous\.value\s*\}\s*await mutation\(\)\s*\}\s*last = task/
    );
    // Every call goes through the queue, and answers from inside it.
    expect(pluginSource.match(/queue\.enqueue \{/g)).toHaveLength(PLUGIN_METHODS.length);
    PLUGIN_METHODS.forEach((method) => {
      const body = functionBody(pluginSource, method);
      const enqueued = body.slice(body.indexOf('queue.enqueue {'));
      expect(enqueued).toContain(`mutations.${method}(`);
      expect(enqueued).toMatch(/call\.resolve\(/);
    });
    expect(pluginSource).not.toMatch(/Task(<[^>]*>)? \{/);
  });

  it('fails a sync that could not be stored and a reconcile whose interactions Siri kept, so that they are tried again', () => {
    expect(functionBody(pluginSource, 'syncAccount')).toMatch(
      /guard mutations\.syncAccount\(accountTag: accountTag, userId: userId\) else \{\s*return call\.reject\("[^"]*", "STORE_ERROR"\)/
    );
    expect(functionBody(pluginSource, 'reconcileAccounts')).toMatch(
      /guard await mutations\.reconcileAccounts\(allowedAccountTags: allowedAccountTags\) else \{\s*return call\.reject\("[^"]*", "INTENTS_ERROR"\)/
    );
    // A call without the list is refused, not taken for "keep none".
    expect(functionBody(pluginSource, 'reconcileAccounts')).toMatch(
      /guard let rawAccountTags = call\.getArray\("allowedAccountTags"\) as\? \[String\] else \{\s*return call\.reject\("[^"]*", "INVALID"\)/
    );
    // What Siri refuses is handed on, never dropped.
    expect(pluginSource).not.toMatch(/try\? await INInteraction/);
    expect(serviceSource).not.toMatch(/try\? await INInteraction/);
    expect(pluginSource).toContain('deleteAll: { try await INInteraction.deleteAll() }');
    expect(pluginSource).toContain('try await INInteraction.delete(with: groupIdentifier)');
    expect(pluginSource).toContain('try await INInteraction.delete(with: [interactionIdentifier])');
  });

  it('removes every account that is not allowed, with its avatars and what Siri keeps of it', () => {
    const reconcile = functionBody(mutationQueueSource, 'reconcileAccounts');
    // The delete is noted down before the account goes, and struck off once Siri has made it.
    expect(reconcile).toMatch(
      /for accountTag in accounts\.allAccountTags\(\)\.subtracting\(allowedAccountTags\) \{[^}]*accounts\.recordPendingGroupDelete\(accountTag\)\s*accounts\.removeAccount\(accountTag: accountTag\)\s*accountGenerations\[accountTag, default: 0\] \+= 1\s*\}\s*avatars\.pruneAccounts\(keeping: allowedAccountTags\)/
    );
    expect(reconcile).toMatch(
      /try await interactions\.deleteGroup\(groupIdentifier\)\s*accounts\.removePendingGroupDelete\(groupIdentifier\)\s*\} catch \{\s*deletedAll = false/
    );
    expect(reconcile).toMatch(
      /try await interactions\.deleteInteraction\(interactionIdentifier\)\s*accounts\.removePendingInteractionDelete\(interactionIdentifier\)\s*\} catch \{\s*deletedAll = false/
    );
    // The group of an account that is allowed again is not deleted.
    expect(reconcile).toContain(
      'for groupIdentifier in pending.groupIdentifiers where !allowedAccountTags.contains(groupIdentifier)'
    );
    // No account allowed: everything goes, and one delete covers every delete that was owed.
    expect(reconcile).toMatch(
      /if allowedAccountTags\.isEmpty \{\s*accounts\.removeAllAccounts\(\)\s*avatars\.clearAll\(\)\s*clearAllGeneration \+= 1\s*do \{\s*try await interactions\.deleteAll\(\)\s*\} catch \{\s*return false\s*\}\s*accounts\.clearAllPendingDeletes\(\)\s*return true/
    );
  });

  it('lets an account that shares again keep what is donated from then on', () => {
    expect(functionBody(mutationQueueSource, 'syncAccount')).toMatch(
      /guard accounts\.saveAccount\(accountTag: accountTag, userId: userId\) else \{\s*return false\s*\}[^}]*accounts\.removePendingGroupDelete\(accountTag\)\s*return true/
    );
    expect(functionBody(mutationQueueSource, 'syncAccount')).not.toContain(
      'removePendingInteractionDelete'
    );
  });

  it('donates an interaction under its account, without the message text', () => {
    expect(serviceSource).toContain('interaction.groupIdentifier = accountTag');
    expect(serviceSource).toContain('interaction.identifier = interactionId');
    expect(serviceSource).not.toContain('mutableContent.body,');
    expect(intentSource.match(/content: nil,/g)).toHaveLength(2);
    expect(intentSource).not.toMatch(/content: (?!nil)/);
    expect(pluginSource).toContain('import Intents');
  });

  it('takes back a donation whose account went away while it was made, and notes down the one it could not take back', () => {
    expect(serviceSource).toContain('NotificationInteractionCoordinator.donateIfValid(');
    // The account is looked at before and after the donation, by its sync.
    expect(interactionSource.match(/isAccountStillValid\(\)/g)).toHaveLength(2);
    expect(serviceSource).toMatch(
      /isAccountStillValid: \{\s*NotificationAccountStore\.shared\.loadAccount\(accountTag: accountTag\)\?\.syncId == account\.syncId\s*\}/
    );
    expect(serviceSource).toMatch(
      /deleteInteraction: \{ interactionId in\s*try await INInteraction\.delete\(with: \[interactionId\]\)\s*\}/
    );
    expect(interactionSource).toMatch(
      /do \{\s*try await deleteInteraction\(interactionId\)\s*\} catch \{\s*recordPendingDelete\(interactionId\)\s*\}\s*return false/
    );
    expect(serviceSource).toMatch(
      /recordPendingDelete: \{ interactionId in\s*NotificationAccountStore\.shared\.recordPendingInteractionDelete\(interactionId\)\s*\}/
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

  it('keeps avatars per room from the plugin call to the lookup for a notification', () => {
    ['syncAvatars', 'storeAvatar'].forEach((method) => {
      expect(functionBody(pluginSource, method)).toContain(
        'Self.trimmedNonEmpty(item["roomId"] as? String)'
      );
    });
    expect(functionBody(mutationQueueSource, 'storeAvatar')).toMatch(
      /avatars\.storeAvatar\(\s*accountTag: accountTag,\s*roomId: entry\.roomId,/
    );
    expect(avatarStoreSource).toContain('sha256Hex("\\(room)\\0\\(sender)")');
  });

  it('answers a list of avatars with the ones it lacks, and stores only what belongs to its latest list', () => {
    expect(avatarStoreSource).toMatch(
      /public func reconcileAccount\(\s*accountTag: String,\s*desiredEntries: \[\(roomId: String\?, sender: String, mxcUrl: String\)\]\s*\) -> \[String\]/
    );
    const sync = functionBody(mutationQueueSource, 'syncAvatars');
    // Nothing is kept for an account that is not shared.
    expect(sync).toMatch(
      /guard accounts\.loadAccount\(accountTag: accountTag\) != nil else \{\s*return AvatarSync\(missingMxcUrls: \[\], syncGeneration: 0\)/
    );
    expect(sync).toMatch(
      /accountGenerations\[accountTag, default: 0\] \+= 1\s*let missingMxcUrls = avatars\.reconcileAccount\(/
    );
    expect(functionBody(pluginSource, 'syncAvatars')).toMatch(
      /call\.resolve\(\[\s*"missingMxcUrls": sync\.missingMxcUrls,\s*"syncGeneration": sync\.syncGeneration,\s*\]\)/
    );
    expect(functionBody(mutationQueueSource, 'storeAvatar')).toMatch(
      /guard accounts\.loadAccount\(accountTag: accountTag\) != nil,\s*currentGeneration\(of: accountTag\) == syncGeneration else \{\s*return/
    );
    expect(mutationQueueSource).toContain(
      'clearAllGeneration + (accountGenerations[accountTag] ?? 0)'
    );
  });

  it('clears the avatar cache without touching the accounts or what Siri keeps', () => {
    const clear = functionBody(mutationQueueSource, 'clearAvatarCache');
    expect(clear).toMatch(/clearAllGeneration \+= 1\s*avatars\.clearAll\(\)\s*\}/);
    expect(clear).not.toMatch(/accounts\.|interactions\./);
  });

  it('bounds what the app stores and the extension decodes', () => {
    expect(avatarStoreSource).toContain('public static let maxAvatarBytes = 512 * 1024');
    expect(avatarStoreSource).toContain('public static let maxImageDimension = 2048');
    expect(avatarStoreSource).toContain('public static let maxImagePixels = 4_194_304');
    expect(avatarStoreSource).toContain('public static let maxEntriesPerAccount = 250');
    expect(functionBody(pluginSource, 'storeAvatar')).toMatch(
      /let data = call\.getString\("base64Data"\)\.flatMap\(\{ Data\(base64Encoded: \$0\) \}\),\s*data\.count <= NotificationAvatarStore\.maxAvatarBytes else \{\s*return call\.reject\("[^"]*", "INVALID"\)/
    );
    // An image of several frames is never kept as it came.
    expect(avatarStoreSource).toMatch(
      /if CGImageSourceGetCount\(inspected\.source\) == 1,\s*max\(inspected\.width, inspected\.height\) <= maxStoredPixelSize\s*\{\s*return data/
    );
  });

  it('configures Communication Notifications and the App Group only on the right targets, and no shared Keychain', () => {
    // Main iOS app entitlements
    expect(appEntitlements).toContain('<key>aps-environment</key>');
    expect(appEntitlements).toMatch(
      /<key>com\.apple\.developer\.usernotifications\.communication<\/key>\s*<true\/>/
    );
    expect(appEntitlements).toMatch(
      /<key>com\.apple\.security\.application-groups<\/key>\s*<array>\s*<string>group\.chat\.mindroom\.app<\/string>\s*<\/array>/
    );

    // Notification Service Extension entitlements: the App Group, and nothing else
    expect(serviceEntitlements.match(/<key>[^<]*<\/key>/g)).toEqual([
      '<key>com.apple.security.application-groups</key>',
    ]);
    expect(serviceEntitlements).toContain('<string>group.chat.mindroom.app</string>');

    [appEntitlements, serviceEntitlements].forEach((entitlements) =>
      expect(entitlements).not.toContain('keychain-access-groups')
    );
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
    expect(serviceSource).toContain('mutableContent.updating(from: intent)');
    expect(serviceSource).toContain('serviceExtensionTimeWillExpire');
  });
});
