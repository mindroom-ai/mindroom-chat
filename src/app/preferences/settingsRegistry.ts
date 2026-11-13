import type { ParseKeys } from 'i18next';

/**
 * Every page and setting of the Settings dialog, in display order. The menu, settings search,
 * the `/settings/<page>` deep link and the agents' `open_settings` requests all read this list.
 * Pages render their settings with `SettingTile focusId={entry id}`, which also shows where
 * the setting applies.
 */

type TranslationKey = ParseKeys;

/** Where a setting's value is stored, so where a change applies. */
export type SettingScope = 'device' | 'account' | 'room-personal' | 'room-shared';

/** The label each scope shows next to its settings. */
export const SETTING_SCOPE_LABEL_KEYS = {
  device: 'featureUi.settings.scope.device',
  account: 'featureUi.settings.scope.account',
  'room-personal': 'featureUi.settings.scope.roomPersonal',
  'room-shared': 'featureUi.settings.scope.roomShared',
} as const satisfies Record<SettingScope, TranslationKey>;

/** What decides whether a page or setting is offered right now. */
export type SettingsContext = {
  /** Inside the iOS or Android app. */
  native: boolean;
  nativeIOS: boolean;
  /** The account can pair a Local MindRoom. */
  localMindroom: boolean;
  /** The signed-in user administers the homeserver. */
  serverAdmin: boolean;
  useSystemTheme: boolean;
  developerTools: boolean;
  /** The deployment names an error collector (`errorReporting.dsn` in config.json). */
  errorReporting: boolean;
  /** The sidebar buttons the deployment offers a switch for. */
  railButtons: Readonly<Record<string, boolean>>;
};

export const SETTINGS_GROUPS = [
  { id: 'you', labelKey: 'featureUi.settings.menu.groups.you' },
  { id: 'app', labelKey: 'featureUi.settings.menu.groups.app' },
  { id: 'agents', labelKey: 'featureUi.settings.menu.groups.agents' },
  { id: 'rooms', labelKey: 'nav.rooms' },
  { id: 'server', labelKey: 'serverAccounts.group' },
  { id: 'help', labelKey: 'featureUi.settings.menu.groups.help' },
] as const satisfies ReadonlyArray<{ id: string; labelKey: TranslationKey }>;

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]['id'];

/** What decides whether a page is offered: the platform and the account. */
export type SettingsPageContext = Pick<SettingsContext, 'native' | 'localMindroom' | 'serverAdmin'>;

type PageDefinition = {
  id: string;
  group: SettingsGroupId;
  labelKey: TranslationKey;
  /** Earlier ids of this page, still accepted wherever a page id is. */
  aliases?: readonly string[];
  hidden?: (context: SettingsPageContext) => boolean;
};

export const SETTINGS_PAGES = [
  { id: 'account', group: 'you', labelKey: 'settings.nav.account' },
  { id: 'notifications', group: 'you', labelKey: 'settings.nav.notifications' },
  {
    id: 'privacy',
    group: 'you',
    labelKey: 'featureUi.settings.menu.pages.privacy',
    aliases: ['devices'],
  },
  {
    id: 'appearance',
    group: 'app',
    labelKey: 'settings.general.appearance.sectionTitle',
    aliases: ['general'],
  },
  { id: 'chats', group: 'app', labelKey: 'nav.chats', aliases: ['emojis-stickers'] },
  { id: 'sidebar', group: 'app', labelKey: 'featureUi.settings.sidebar.title' },
  { id: 'language', group: 'app', labelKey: 'featureUi.settings.menu.pages.language' },
  {
    id: 'connections',
    group: 'agents',
    labelKey: 'settings.general.connections.title',
    // The apps have no pop-up window to sign the portal in with.
    hidden: (context) => context.native,
  },
  { id: 'computers', group: 'agents', labelKey: 'settings.general.computers.sectionTitle' },
  {
    id: 'mindroom.local-mindroom',
    group: 'agents',
    labelKey: 'mindroomUi.local-mindroom.localMindroom.localMindroom',
    aliases: ['local-mindroom'],
    hidden: (context) => !context.localMindroom,
  },
  { id: 'archived-rooms', group: 'rooms', labelKey: 'archivedRooms.title' },
  {
    id: 'server-accounts',
    group: 'server',
    labelKey: 'serverAccounts.title',
    hidden: (context) => !context.serverAdmin,
  },
  { id: 'storage', group: 'help', labelKey: 'featureUi.settings.menu.pages.storage' },
  {
    id: 'developer-tools',
    group: 'help',
    labelKey: 'settings.nav.developerTools',
    aliases: ['developer'],
  },
  { id: 'about', group: 'help', labelKey: 'settings.nav.about' },
] as const satisfies readonly PageDefinition[];

export type SettingsPageId = (typeof SETTINGS_PAGES)[number]['id'];

type PageAlias = (typeof SETTINGS_PAGES)[number] extends infer Page
  ? Page extends { aliases: readonly (infer Alias)[] }
    ? Alias
    : never
  : never;

/** A page id or one of the earlier ids that still lead to a page. */
export type SettingsPageRequest = SettingsPageId | PageAlias;

/** Where a desktop dialog opens without a request; earlier it was General. */
export const DEFAULT_SETTINGS_PAGE: SettingsPageId = 'appearance';

export type SettingDefinition = {
  id: string;
  page: SettingsPageId;
  /** The heading of the group on the page that holds it, when it has one. */
  group?: TranslationKey;
  labelKey: TranslationKey;
  descriptionKey?: TranslationKey;
  /** Comma-separated search words in each language. */
  keywordsKey?: TranslationKey;
  scope: SettingScope;
  /** Sits in the page's closed Advanced fold. */
  advanced?: boolean;
  hidden?: (context: SettingsContext) => boolean;
};

const KEYWORDS = 'featureUi.settings.keywords';
const NOTIFY = 'featureUi.settings.notifications';
const ALL = `${NOTIFY}.allMessages`;
const SPECIAL = `${NOTIFY}.specialMessages`;
const SIDEBAR = 'featureUi.settings.sidebar';
const DEVICES = 'featureUi.settings.devices';
const PACKS = 'featureUi.settings.emojisStickers';
const LOCAL = 'mindroomUi.local-mindroom.localMindroom';
const ABOUT = 'featureUi.settings.about';
const DEV = 'featureUi.settings.developerTools';

/** The setting of each sidebar button's switch. */
export const SIDEBAR_SWITCH_SETTINGS = {
  threads: 'sidebarThreads',
  canvases: 'sidebarCanvases',
  explore: 'sidebarExplore',
  createSpace: 'sidebarCreateSpace',
  search: 'sidebarSearch',
  localMindroom: 'sidebarLocalMindroom',
} as const;

const sidebarSwitch = (
  button: keyof typeof SIDEBAR_SWITCH_SETTINGS,
  labelKey: TranslationKey,
  descriptionKey: TranslationKey
): SettingDefinition => ({
  id: SIDEBAR_SWITCH_SETTINGS[button],
  page: 'sidebar',
  group: `${SIDEBAR}.title`,
  labelKey,
  descriptionKey,
  keywordsKey: `${KEYWORDS}.sidebar`,
  scope: 'account',
  hidden: (context) => !context.railButtons[button],
});

export const SETTINGS = [
  // You: Account
  {
    id: 'avatar',
    page: 'account',
    group: 'featureUi.settings.account.profile.profile',
    labelKey: 'featureUi.settings.account.profile.avatar',
    keywordsKey: `${KEYWORDS}.profile`,
    scope: 'account',
  },
  {
    id: 'displayName',
    page: 'account',
    group: 'featureUi.settings.account.profile.profile',
    labelKey: 'featureUi.settings.account.profile.displayName',
    keywordsKey: `${KEYWORDS}.profile`,
    scope: 'account',
  },
  {
    id: 'email',
    page: 'account',
    group: 'featureUi.settings.account.contactInfo.contactInformation',
    labelKey: 'featureUi.settings.account.contactInfo.emailAddress',
    descriptionKey: 'featureUi.settings.account.contactInfo.emailAddressAttachedToYourAccount',
    keywordsKey: `${KEYWORDS}.email`,
    scope: 'account',
  },
  {
    id: 'deactivateAccount',
    page: 'account',
    group: 'featureUi.settings.account.accountDeactivation.accountManagement',
    labelKey: 'featureUi.settings.account.accountDeactivation.deleteDeactivateAccount',
    keywordsKey: `${KEYWORDS}.deactivate`,
    scope: 'account',
  },
  // You: Notifications
  {
    id: 'desktopNotifications',
    page: 'notifications',
    group: `${NOTIFY}.systemNotification.system`,
    labelKey: `${NOTIFY}.systemNotification.desktopNotifications`,
    descriptionKey: `${NOTIFY}.systemNotification.showDesktopNotificationsWhenMessageArrive`,
    keywordsKey: `${KEYWORDS}.alerts`,
    scope: 'device',
  },
  {
    id: 'notificationSound',
    page: 'notifications',
    group: `${NOTIFY}.systemNotification.system`,
    labelKey: `${NOTIFY}.systemNotification.notificationSound`,
    descriptionKey: `${NOTIFY}.systemNotification.playSoundWhenNewMessageArrive`,
    keywordsKey: `${KEYWORDS}.alerts`,
    scope: 'device',
  },
  {
    id: 'pushNotifications',
    page: 'notifications',
    group: `${NOTIFY}.systemNotification.system`,
    labelKey: 'mindroomUi.native.iOSPushNotification.iosPushNotifications',
    keywordsKey: `${KEYWORDS}.alerts`,
    scope: 'device',
    hidden: (context) => !context.nativeIOS,
  },
  {
    id: 'emailNotifications',
    page: 'notifications',
    group: `${NOTIFY}.systemNotification.system`,
    labelKey: `${NOTIFY}.systemNotification.emailNotification`,
    keywordsKey: `${KEYWORDS}.email`,
    scope: 'account',
  },
  {
    id: 'notifyDirect',
    page: 'notifications',
    group: `${ALL}.allMessages`,
    labelKey: `${ALL}.1To1Chats`,
    keywordsKey: `${KEYWORDS}.alerts`,
    scope: 'account',
  },
  {
    id: 'notifyDirectEncrypted',
    page: 'notifications',
    group: `${ALL}.allMessages`,
    labelKey: `${ALL}.1To1ChatsEncrypted`,
    keywordsKey: `${KEYWORDS}.alerts`,
    scope: 'account',
  },
  {
    id: 'notifyRooms',
    page: 'notifications',
    group: `${ALL}.allMessages`,
    labelKey: `${ALL}.rooms`,
    keywordsKey: `${KEYWORDS}.alerts`,
    scope: 'account',
  },
  {
    id: 'notifyRoomsEncrypted',
    page: 'notifications',
    group: `${ALL}.allMessages`,
    labelKey: `${ALL}.roomsEncrypted`,
    keywordsKey: `${KEYWORDS}.alerts`,
    scope: 'account',
  },
  {
    id: 'notifyUserMention',
    page: 'notifications',
    group: `${SPECIAL}.specialMessages`,
    labelKey: `${SPECIAL}.mentionUserId`,
    keywordsKey: `${KEYWORDS}.mentions`,
    scope: 'account',
  },
  {
    id: 'notifyDisplayName',
    page: 'notifications',
    group: `${SPECIAL}.specialMessages`,
    labelKey: `${SPECIAL}.containsDisplayNameGeneric`,
    keywordsKey: `${KEYWORDS}.mentions`,
    scope: 'account',
  },
  {
    id: 'notifyUsername',
    page: 'notifications',
    group: `${SPECIAL}.specialMessages`,
    labelKey: `${SPECIAL}.containsUsername`,
    keywordsKey: `${KEYWORDS}.mentions`,
    scope: 'account',
  },
  {
    id: 'notifyRoomMention',
    page: 'notifications',
    group: `${SPECIAL}.specialMessages`,
    labelKey: `${SPECIAL}.mentionRoom`,
    keywordsKey: `${KEYWORDS}.mentions`,
    scope: 'account',
  },
  {
    id: 'notifyRoomText',
    page: 'notifications',
    group: `${SPECIAL}.specialMessages`,
    labelKey: `${SPECIAL}.containsRoom`,
    keywordsKey: `${KEYWORDS}.mentions`,
    scope: 'account',
  },
  {
    id: 'notifyKeywords',
    page: 'notifications',
    group: `${NOTIFY}.keywordMessages.keywordMessages`,
    labelKey: `${NOTIFY}.keywordMessages.selectKeyword`,
    descriptionKey: `${NOTIFY}.keywordMessages.setANotificationPreferenceForMessageContaining`,
    keywordsKey: `${KEYWORDS}.mentions`,
    scope: 'account',
  },
  // You: Privacy & security
  {
    id: 'hideActivity',
    page: 'privacy',
    group: 'featureUi.settings.sections.privacy',
    labelKey: 'settings.general.editor.hideActivity',
    descriptionKey: 'settings.general.editor.hideActivityDescription',
    keywordsKey: `${KEYWORDS}.receipts`,
    scope: 'account',
  },
  {
    id: 'encUrlPreview',
    page: 'privacy',
    group: 'featureUi.settings.sections.privacy',
    labelKey: 'settings.general.messages.urlPreviewEncrypted',
    keywordsKey: `${KEYWORDS}.links`,
    scope: 'device',
  },
  {
    id: 'blockedUsers',
    page: 'privacy',
    group: 'featureUi.settings.account.ignoredUserList.blockedUsers',
    labelKey: 'featureUi.settings.account.ignoredUserList.selectUser',
    descriptionKey:
      'featureUi.settings.account.ignoredUserList.preventReceivingMessagesOrInvitesFromUser',
    keywordsKey: `${KEYWORDS}.blocked`,
    scope: 'account',
  },
  {
    id: 'deviceVerification',
    page: 'privacy',
    group: `${DEVICES}.security`,
    labelKey: `${DEVICES}.deviceVerification`,
    keywordsKey: `${KEYWORDS}.encryption`,
    scope: 'account',
  },
  {
    id: 'recoveryPassword',
    page: 'privacy',
    group: `${DEVICES}.security`,
    labelKey: 'sharedUi.recoveryPassword.title',
    keywordsKey: `${KEYWORDS}.encryption`,
    scope: 'account',
  },
  {
    id: 'keyBackup',
    page: 'privacy',
    group: `${DEVICES}.security`,
    labelKey: 'sharedUi.backupRestore.encryptionBackup',
    keywordsKey: `${KEYWORDS}.encryption`,
    scope: 'account',
  },
  {
    id: 'currentSession',
    page: 'privacy',
    group: `${DEVICES}.current`,
    labelKey: `${DEVICES}.current`,
    keywordsKey: `${KEYWORDS}.sessions`,
    scope: 'account',
  },
  {
    id: 'otherSessions',
    page: 'privacy',
    group: `${DEVICES}.otherDevices.others`,
    labelKey: `${DEVICES}.otherDevices.others`,
    keywordsKey: `${KEYWORDS}.sessions`,
    scope: 'account',
  },
  {
    id: 'exportKeys',
    page: 'privacy',
    group: `${DEVICES}.localBackup.localBackup`,
    labelKey: `${DEVICES}.localBackup.exportMessagesData`,
    descriptionKey: `${DEVICES}.localBackup.savePasswordProtectedCopyOfEncryptionData`,
    keywordsKey: `${KEYWORDS}.encryption`,
    scope: 'device',
    advanced: true,
  },
  {
    id: 'importKeys',
    page: 'privacy',
    group: `${DEVICES}.localBackup.localBackup`,
    labelKey: `${DEVICES}.localBackup.importMessagesData`,
    descriptionKey: `${DEVICES}.localBackup.loadPasswordProtectedCopyOfEncryptionData`,
    keywordsKey: `${KEYWORDS}.encryption`,
    scope: 'device',
    advanced: true,
  },
  // This app: Appearance
  {
    id: 'systemTheme',
    page: 'appearance',
    group: 'settings.general.appearance.theme',
    labelKey: 'settings.general.appearance.systemTheme',
    descriptionKey: 'settings.general.appearance.systemThemeDescription',
    keywordsKey: `${KEYWORDS}.theme`,
    scope: 'device',
  },
  {
    id: 'theme',
    page: 'appearance',
    group: 'settings.general.appearance.theme',
    labelKey: 'settings.general.appearance.theme',
    descriptionKey: 'settings.general.appearance.themeDescription',
    keywordsKey: `${KEYWORDS}.theme`,
    scope: 'device',
    hidden: (context) => context.useSystemTheme,
  },
  {
    id: 'lightTheme',
    page: 'appearance',
    group: 'settings.general.appearance.theme',
    labelKey: 'settings.general.appearance.lightTheme',
    keywordsKey: `${KEYWORDS}.theme`,
    scope: 'device',
    hidden: (context) => !context.useSystemTheme,
  },
  {
    id: 'darkTheme',
    page: 'appearance',
    group: 'settings.general.appearance.theme',
    labelKey: 'settings.general.appearance.darkTheme',
    keywordsKey: `${KEYWORDS}.theme`,
    scope: 'device',
    hidden: (context) => !context.useSystemTheme,
  },
  {
    id: 'pageZoom',
    page: 'appearance',
    group: 'featureUi.settings.sections.display',
    labelKey: 'settings.general.appearance.pageZoom',
    keywordsKey: `${KEYWORDS}.zoom`,
    scope: 'device',
  },
  {
    id: 'messageLayout',
    page: 'appearance',
    group: 'featureUi.settings.sections.display',
    labelKey: 'settings.general.messages.messageLayout',
    keywordsKey: `${KEYWORDS}.layout`,
    scope: 'device',
  },
  {
    id: 'messageSpacing',
    page: 'appearance',
    group: 'featureUi.settings.sections.display',
    labelKey: 'settings.general.messages.messageSpacing',
    keywordsKey: `${KEYWORDS}.layout`,
    scope: 'device',
    advanced: true,
  },
  // This app: Chats
  {
    id: 'enterForNewline',
    page: 'chats',
    group: 'settings.general.editor.sectionTitle',
    labelKey: 'settings.general.editor.enterForNewline',
    descriptionKey: 'settings.general.editor.enterForNewlineDescription',
    keywordsKey: `${KEYWORDS}.composer`,
    scope: 'account',
  },
  {
    id: 'markdown',
    page: 'chats',
    group: 'settings.general.editor.sectionTitle',
    labelKey: 'settings.general.editor.markdownFormatting',
    keywordsKey: `${KEYWORDS}.composer`,
    scope: 'account',
  },
  {
    id: 'hideMembershipEvents',
    page: 'chats',
    group: 'settings.general.messages.sectionTitle',
    labelKey: 'settings.general.messages.hideMembershipChange',
    keywordsKey: `${KEYWORDS}.timeline`,
    scope: 'account',
  },
  {
    id: 'hideNickAvatarEvents',
    page: 'chats',
    group: 'settings.general.messages.sectionTitle',
    labelKey: 'settings.general.messages.hideProfileChange',
    keywordsKey: `${KEYWORDS}.timeline`,
    scope: 'account',
  },
  {
    id: 'showToolCalls',
    page: 'chats',
    group: 'settings.general.messages.sectionTitle',
    labelKey: 'mindroomUi.messages.showToolCalls',
    descriptionKey: 'mindroomUi.messages.showToolCallsDescription',
    keywordsKey: `${KEYWORDS}.timeline`,
    scope: 'account',
  },
  {
    id: 'mediaAutoLoad',
    page: 'chats',
    group: 'settings.general.messages.sectionTitle',
    labelKey: 'settings.general.messages.disableMediaAutoLoad',
    keywordsKey: `${KEYWORDS}.media`,
    scope: 'device',
  },
  {
    id: 'urlPreview',
    page: 'chats',
    group: 'settings.general.messages.sectionTitle',
    labelKey: 'settings.general.messages.urlPreview',
    keywordsKey: `${KEYWORDS}.links`,
    scope: 'account',
  },
  {
    id: 'personalPack',
    page: 'chats',
    group: `${PACKS}.userPack.title`,
    labelKey: `${PACKS}.userPack.title`,
    keywordsKey: `${KEYWORDS}.emoji`,
    scope: 'account',
  },
  {
    id: 'favoritePacks',
    page: 'chats',
    group: `${PACKS}.globalPacks.favoritePacks`,
    labelKey: `${PACKS}.globalPacks.selectPack`,
    descriptionKey: `${PACKS}.globalPacks.pickEmojisAndStickersPackFromRooms`,
    keywordsKey: `${KEYWORDS}.emoji`,
    scope: 'account',
  },
  {
    id: 'serverEmoji',
    page: 'chats',
    group: `${PACKS}.serverPack.title`,
    labelKey: `${PACKS}.serverPack.title`,
    keywordsKey: `${KEYWORDS}.emoji`,
    scope: 'room-shared',
  },
  // This app: Sidebar
  sidebarSwitch('threads', `${SIDEBAR}.threads`, `${SIDEBAR}.threadsDescription`),
  sidebarSwitch(
    'canvases',
    'settings.general.interface.showCanvasesInSidebar',
    `${SIDEBAR}.canvasesDescription`
  ),
  sidebarSwitch('explore', `${SIDEBAR}.explore`, `${SIDEBAR}.exploreDescription`),
  sidebarSwitch('createSpace', `${SIDEBAR}.createSpace`, `${SIDEBAR}.createSpaceDescription`),
  sidebarSwitch('search', `${SIDEBAR}.search`, `${SIDEBAR}.searchDescription`),
  sidebarSwitch('localMindroom', `${SIDEBAR}.localMindroom`, `${SIDEBAR}.localMindroomDescription`),
  // This app: Language & region
  {
    id: 'language',
    page: 'language',
    group: 'settings.general.language.sectionTitle',
    labelKey: 'settings.general.language.appLanguage',
    descriptionKey: 'settings.general.language.appLanguageDescription',
    keywordsKey: `${KEYWORDS}.language`,
    scope: 'device',
  },
  {
    id: 'hour24Clock',
    page: 'language',
    group: 'settings.general.dateTime.sectionTitle',
    labelKey: 'settings.general.dateTime.hour24Clock',
    keywordsKey: `${KEYWORDS}.time`,
    scope: 'account',
  },
  {
    id: 'dateFormat',
    page: 'language',
    group: 'settings.general.dateTime.sectionTitle',
    labelKey: 'settings.general.dateTime.dateFormat',
    keywordsKey: `${KEYWORDS}.time`,
    scope: 'account',
  },
  // Agents & connections
  {
    id: 'connectedAccounts',
    page: 'connections',
    group: 'settings.general.connections.sectionTitle',
    labelKey: 'settings.general.connections.title',
    descriptionKey: 'settings.general.connections.description',
    keywordsKey: `${KEYWORDS}.connections`,
    scope: 'account',
    hidden: (context) => context.native,
  },
  {
    id: 'computerServerInUse',
    page: 'computers',
    group: 'settings.general.computers.sectionTitle',
    labelKey: 'featureUi.settings.computers.inUse',
    keywordsKey: `${KEYWORDS}.computers`,
    scope: 'device',
  },
  {
    id: 'computerServer',
    page: 'computers',
    group: 'settings.general.computers.sectionTitle',
    labelKey: 'settings.general.computers.apiUrl',
    descriptionKey: 'settings.general.computers.description',
    keywordsKey: `${KEYWORDS}.computers`,
    scope: 'device',
    advanced: true,
  },
  {
    id: 'pairLocalMindroom',
    page: 'mindroom.local-mindroom',
    group: `${LOCAL}.localMindroom`,
    labelKey: `${LOCAL}.pairThisChatAccountWithYourLocalMindroomProcess`,
    keywordsKey: `${KEYWORDS}.localMindroom`,
    scope: 'account',
    hidden: (context) => !context.localMindroom,
  },
  {
    id: 'linkedInstallations',
    page: 'mindroom.local-mindroom',
    group: `${LOCAL}.linkedInstallations`,
    labelKey: `${LOCAL}.linkedInstallations`,
    keywordsKey: `${KEYWORDS}.localMindroom`,
    scope: 'account',
    hidden: (context) => !context.localMindroom,
  },
  // Rooms
  {
    id: 'archivedRooms',
    page: 'archived-rooms',
    labelKey: 'archivedRooms.title',
    keywordsKey: `${KEYWORDS}.archive`,
    scope: 'room-personal',
  },
  // Help & advanced
  {
    id: 'prefetchScope',
    page: 'storage',
    labelKey: 'settings.general.messages.prefetchScope',
    descriptionKey: 'settings.general.messages.prefetchScopeDescription',
    keywordsKey: `${KEYWORDS}.background`,
    scope: 'device',
  },
  {
    id: 'clearCache',
    page: 'storage',
    labelKey: `${ABOUT}.clearCacheAndReload`,
    descriptionKey: `${ABOUT}.clearCacheDescription`,
    keywordsKey: `${KEYWORDS}.cache`,
    scope: 'device',
  },
  {
    id: 'developerTools',
    page: 'developer-tools',
    group: `${DEV}.developTools.options`,
    labelKey: `${DEV}.developTools.enableDeveloperTools`,
    keywordsKey: `${KEYWORDS}.developer`,
    scope: 'device',
  },
  {
    id: 'showHiddenEvents',
    page: 'developer-tools',
    group: `${DEV}.developTools.options`,
    labelKey: 'settings.general.messages.showHiddenEvents',
    keywordsKey: `${KEYWORDS}.developer`,
    scope: 'device',
  },
  {
    id: 'accessToken',
    page: 'developer-tools',
    group: `${DEV}.developTools.options`,
    labelKey: `${DEV}.developTools.accessToken`,
    descriptionKey: `${DEV}.developTools.copyAccessTokenToClipboard`,
    keywordsKey: `${KEYWORDS}.developer`,
    scope: 'device',
    hidden: (context) => !context.developerTools,
  },
  {
    id: 'accountData',
    page: 'developer-tools',
    group: `${DEV}.accountData.accountData`,
    labelKey: `${DEV}.accountData.global`,
    descriptionKey: `${DEV}.accountData.dataStoredInYourGlobalAccountData`,
    keywordsKey: `${KEYWORDS}.developer`,
    scope: 'account',
    hidden: (context) => !context.developerTools,
  },
  {
    id: 'diagnosticsExport',
    page: 'about',
    group: `${ABOUT}.options`,
    labelKey: `${ABOUT}.onDeviceDiagnostics`,
    scope: 'device',
    hidden: (context) => !context.nativeIOS,
  },
  {
    id: 'deepTrace',
    page: 'about',
    group: `${ABOUT}.options`,
    labelKey: `${ABOUT}.deepDiagnosticTracing`,
    scope: 'device',
    hidden: (context) => !context.nativeIOS,
  },
  {
    id: 'errorReports',
    page: 'about',
    group: `${ABOUT}.options`,
    labelKey: 'featureUi.settings.errorReports.title',
    descriptionKey: 'featureUi.settings.errorReports.description',
    keywordsKey: `${KEYWORDS}.errorReports`,
    scope: 'device',
    hidden: (context) => !context.errorReporting,
  },
] as const satisfies readonly SettingDefinition[];

const PAGE_BY_REQUEST = new Map<string, SettingsPageId>(
  SETTINGS_PAGES.flatMap(
    (page): Array<[string, SettingsPageId]> => [
      [page.id, page.id],
      ...('aliases' in page
        ? page.aliases.map((alias): [string, SettingsPageId] => [alias, page.id])
        : []),
    ]
  )
);

/** The page an id or earlier id names; `undefined` for anything else. */
export const resolveSettingsPageId = (request: unknown): SettingsPageId | undefined =>
  typeof request === 'string' ? PAGE_BY_REQUEST.get(request) : undefined;

/** Whether `request` names a settings page, under its id or an earlier one. */
export const isSettingsPageRequest = (request: unknown): request is SettingsPageRequest =>
  resolveSettingsPageId(request) !== undefined;

const pageDefinition = (id: SettingsPageId): PageDefinition =>
  SETTINGS_PAGES.find((page) => page.id === id) as PageDefinition;

export const isSettingsPageShown = (id: SettingsPageId, context: SettingsPageContext): boolean =>
  !pageDefinition(id).hidden?.(context);

/** The pages of the menu in display order, without the ones this account or app lacks. */
export const getShownSettingsPages = (context: SettingsPageContext) =>
  SETTINGS_PAGES.filter((page) => isSettingsPageShown(page.id, context));

export const getSettingDefinition = (id: string): SettingDefinition | undefined =>
  (SETTINGS as readonly SettingDefinition[]).find((setting) => setting.id === id);

/** The settings search can lead to now: their page and the setting itself are offered. */
export const getShownSettings = (context: SettingsContext): SettingDefinition[] =>
  (SETTINGS as readonly SettingDefinition[]).filter(
    (setting) => isSettingsPageShown(setting.page, context) && !setting.hidden?.(context)
  );
