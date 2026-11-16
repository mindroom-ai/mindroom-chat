import type { CommandPaletteTab } from '../commandPaletteTypes';
import type { CorpusLanguage } from './searchCorpusSource';

/** What a case is about; the corpus reports its numbers per group. */
export type CorpusGroup =
  | 'names'
  | 'prefix'
  | 'acronym'
  | 'typo'
  | 'accent'
  | 'words'
  | 'scripts'
  | 'all'
  | 'fields';

/**
 * Typed text on a tab, and the rows a person expects. A row is named by its ID; an ID that ends
 * in a colon names every row whose ID starts with it.
 */
export type CorpusCase = {
  group: CorpusGroup;
  tab: Exclude<CommandPaletteTab, 'messages'>;
  query: string;
  /** The app language; English when left out. */
  language?: CorpusLanguage;
  /** The first row of the tab (on All, the first row of the list) is this row or one of these. */
  first?: string | string[];
  /** These rows are among the first `within` rows; among all the rows shown without it. */
  shown?: string[];
  within?: number;
  /** Each pair's first row is shown above its second, or its second is not shown. */
  before?: [string, string][];
  /** None of these rows is shown. */
  absent?: string[];
  /** The tab shows no row. */
  empty?: true;
};

const SETTING_ROWS = ['setting:', 'theme:', 'message-layout:', 'language:'];

// First names that are no word, word start or abbreviation of any command.
const NAMES = [
  'john',
  'lisa',
  'emma',
  'james',
  'sarah',
  'peter',
  'laura',
  'david',
  'linda',
  'karen',
  'paula',
  'nina',
  'jonas',
  'felix',
  'sophie',
  'oliver',
  'lucas',
  'hugo',
  'olga',
  'yuki',
];

const names: CorpusCase[] = [
  // A person's name is no command: the Actions tab stays empty.
  ...NAMES.map((query): CorpusCase => ({ group: 'names', tab: 'actions', query, empty: true })),
  { group: 'names', tab: 'all', query: 'john', shown: ['user:john'], absent: SETTING_ROWS },
  { group: 'names', tab: 'all', query: 'lisa', first: 'user:lisa', absent: SETTING_ROWS },
  { group: 'names', tab: 'all', query: 'emma', first: 'user:emma', absent: SETTING_ROWS },
  { group: 'names', tab: 'rooms', query: 'lisa', empty: true },
  { group: 'names', tab: 'rooms', query: 'emma', empty: true },
  { group: 'names', tab: 'rooms', query: 'johnson', first: 'room:johnson-account' },
  { group: 'names', tab: 'users', query: 'room', empty: true },
  { group: 'names', tab: 'users', query: 'qqq', empty: true },
  { group: 'names', tab: 'threads', query: 'zzz', empty: true },
  { group: 'names', tab: 'actions', query: 'xyzzy', empty: true },
  { group: 'names', tab: 'rooms', query: 'xyz', empty: true },
  {
    group: 'names',
    tab: 'threads',
    query: 'john',
    first: 'thread:john-access',
    shown: ['thread:invoice'],
    within: 2,
  },
];

const prefix: CorpusCase[] = [
  { group: 'prefix', tab: 'actions', query: 'room', first: 'create-room' },
  {
    group: 'prefix',
    tab: 'actions',
    query: 'room',
    before: [['create-room', 'setting:archivedRooms']],
  },
  { group: 'prefix', tab: 'actions', query: 'set', first: 'open-settings' },
  { group: 'prefix', tab: 'actions', query: 'settings', first: 'open-settings' },
  { group: 'prefix', tab: 'actions', query: 'home', first: 'go-home' },
  { group: 'prefix', tab: 'actions', query: 'logout', first: 'logout' },
  { group: 'prefix', tab: 'actions', query: 'log', first: 'logout' },
  { group: 'prefix', tab: 'actions', query: 'theme', first: 'page-theme' },
  { group: 'prefix', tab: 'actions', query: 'toggle', first: 'toggle-theme' },
  {
    group: 'prefix',
    tab: 'actions',
    query: 'tour',
    first: 'take-quick-tour',
    shown: ['take-full-tour'],
    within: 2,
  },
  { group: 'prefix', tab: 'actions', query: 'lang', first: 'page-language' },
  { group: 'prefix', tab: 'actions', query: 'layout', first: 'page-message-layout' },
  { group: 'prefix', tab: 'actions', query: 'zoom', first: 'setting:pageZoom' },
  { group: 'prefix', tab: 'actions', query: 'cache', first: 'setting:clearCache' },
  { group: 'prefix', tab: 'actions', query: 'avatar', first: 'setting:avatar' },
  { group: 'prefix', tab: 'actions', query: 'markdown', first: 'setting:markdown' },
  { group: 'prefix', tab: 'actions', query: 'dracula', first: 'theme:dracula' },
  { group: 'prefix', tab: 'actions', query: 'nord', first: 'theme:nord' },
  { group: 'prefix', tab: 'actions', query: 'dark', first: 'theme:dark' },
  { group: 'prefix', tab: 'actions', query: 'light', first: 'theme:light' },
  { group: 'prefix', tab: 'actions', query: 'deutsch', first: 'language:de' },
  { group: 'prefix', tab: 'actions', query: 'english', first: 'language:en' },
  { group: 'prefix', tab: 'actions', query: 'bubble', first: 'message-layout:bubble' },
  { group: 'prefix', tab: 'actions', query: 'shortcuts', first: 'shortcut:help' },
  {
    group: 'prefix',
    tab: 'actions',
    query: 'unread',
    first: ['shortcut:nextUnread', 'shortcut:previousUnread'],
  },
  {
    group: 'prefix',
    tab: 'actions',
    query: 'call',
    first: ['call-agent:code', 'call-agent:research'],
  },
  {
    group: 'prefix',
    tab: 'actions',
    query: 'sidebar',
    first: [
      'setting:sidebarThreads',
      'setting:sidebarExplore',
      'setting:sidebarCreateSpace',
      'setting:sidebarSearch',
    ],
  },
  { group: 'prefix', tab: 'rooms', query: 'gen', first: 'room:general' },
  {
    group: 'prefix',
    tab: 'rooms',
    query: 'eng',
    first: 'room:engineering',
    shown: ['room:eng-platform', 'room:space-engineering'],
    within: 3,
  },
  {
    group: 'prefix',
    tab: 'rooms',
    query: 'design',
    first: 'room:design',
    shown: ['room:design-system'],
    within: 2,
  },
  {
    group: 'prefix',
    tab: 'rooms',
    query: 'plat',
    first: 'room:platform-reliability',
    shown: ['room:eng-platform'],
    within: 2,
  },
  {
    group: 'prefix',
    tab: 'rooms',
    query: 'sup',
    shown: ['room:support-escalations', 'room:customer-support'],
    within: 2,
  },
  {
    group: 'prefix',
    tab: 'rooms',
    query: 'plan',
    shown: ['room:release-planning', 'room:onboarding-redesign'],
    within: 2,
  },
  { group: 'prefix', tab: 'rooms', query: 'sync', first: 'room:weekly-sync' },
  { group: 'prefix', tab: 'rooms', query: 'water', first: 'room:watercooler' },
  { group: 'prefix', tab: 'rooms', query: 'ann', first: 'room:announcements' },
  {
    group: 'prefix',
    tab: 'rooms',
    query: 'dev',
    shown: ['room:dev-ops', 'room:mindroom-dev'],
    within: 2,
  },
  {
    group: 'prefix',
    tab: 'rooms',
    query: 'mind',
    shown: ['room:space-mindroom', 'room:mindroom-dev'],
    within: 2,
  },
  { group: 'prefix', tab: 'rooms', query: 'room', first: 'room:space-mindroom' },
  { group: 'prefix', tab: 'users', query: 'joh', first: 'user:john' },
  {
    group: 'prefix',
    tab: 'users',
    query: 'john',
    first: 'user:john',
    shown: ['user:johnny', 'user:alice'],
    within: 3,
  },
  {
    group: 'prefix',
    tab: 'users',
    query: 'chris',
    first: 'user:chris',
    shown: ['user:christina', 'user:christopher'],
    within: 3,
  },
  { group: 'prefix', tab: 'users', query: 'ann', shown: ['user:anna', 'user:anne'], within: 2 },
  { group: 'prefix', tab: 'users', query: 'smith', first: 'user:john' },
  { group: 'prefix', tab: 'users', query: 'watson', first: 'user:emma' },
  { group: 'prefix', tab: 'users', query: 'snow', first: 'user:jon' },
  {
    group: 'prefix',
    tab: 'users',
    query: 'emm',
    first: 'user:emma',
    shown: ['user:emmanuel'],
    within: 2,
  },
  {
    group: 'prefix',
    tab: 'users',
    query: 'lisa',
    first: 'user:lisa',
    shown: ['user:elisa', 'user:alisa'],
    within: 3,
  },
  { group: 'prefix', tab: 'users', query: 'eli', first: 'user:elisa' },
  { group: 'prefix', tab: 'threads', query: 'login', first: 'thread:login' },
  { group: 'prefix', tab: 'threads', query: 'flaky', first: 'thread:flaky' },
  { group: 'prefix', tab: 'threads', query: 'onboard', first: 'thread:onboarding' },
  { group: 'prefix', tab: 'threads', query: 'rate', first: 'thread:rate-limits' },
  { group: 'prefix', tab: 'threads', query: 'roll', first: 'thread:db-rollback' },
  { group: 'prefix', tab: 'threads', query: 'stand', first: 'thread:standup' },
];

const acronym: CorpusCase[] = [
  { group: 'acronym', tab: 'actions', query: 'cr', first: 'create-room' },
  { group: 'acronym', tab: 'actions', query: 'crm', first: 'create-room' },
  { group: 'acronym', tab: 'actions', query: 'cs', first: 'create-space' },
  { group: 'acronym', tab: 'actions', query: 'gh', first: 'go-home' },
  { group: 'acronym', tab: 'actions', query: 'os', first: 'open-settings' },
  { group: 'acronym', tab: 'actions', query: 'tt', first: 'toggle-theme' },
  { group: 'acronym', tab: 'actions', query: 'mf', first: 'setting:markdown' },
  { group: 'acronym', tab: 'actions', query: 'ml', first: 'page-message-layout' },
  { group: 'acronym', tab: 'actions', query: 'al', shown: ['page-language'], within: 3 },
  { group: 'acronym', tab: 'actions', query: 'pz', first: 'setting:pageZoom' },
  { group: 'acronym', tab: 'actions', query: 'mcrr', first: 'mark-current-room-read' },
  { group: 'acronym', tab: 'actions', query: 'ccrl', first: 'copy-current-room-link' },
  { group: 'acronym', tab: 'actions', query: 'gdm', first: 'go-direct' },
  { group: 'acronym', tab: 'actions', query: 'ocrs', first: 'open-current-room-settings' },
  { group: 'acronym', tab: 'actions', query: 'rct', first: 'resolve-current-thread' },
  { group: 'acronym', tab: 'actions', query: 'ns', first: 'setting:notificationSound' },
  {
    group: 'acronym',
    tab: 'actions',
    query: 'dn',
    first: ['setting:desktopNotifications', 'setting:displayName'],
  },
  { group: 'acronym', tab: 'actions', query: 'opset', first: 'open-settings' },
  { group: 'acronym', tab: 'actions', query: 'togth', first: 'toggle-theme' },
  {
    group: 'acronym',
    tab: 'rooms',
    query: 'pr',
    first: 'room:product-roadmap',
    shown: ['room:platform-reliability'],
    within: 3,
  },
  {
    group: 'acronym',
    tab: 'rooms',
    query: 'ds',
    shown: ['room:design-system', 'room:data-science'],
    within: 2,
  },
  { group: 'acronym', tab: 'rooms', query: 'cs', first: 'room:customer-support' },
  { group: 'acronym', tab: 'rooms', query: 'rp', first: 'room:release-planning' },
  { group: 'acronym', tab: 'rooms', query: 'ws', first: 'room:weekly-sync' },
  { group: 'acronym', tab: 'rooms', query: 'bc', first: 'room:book-club' },
  { group: 'acronym', tab: 'rooms', query: 'dm', first: 'room:database-migration' },
  { group: 'acronym', tab: 'rooms', query: 'ep', first: 'room:eng-platform' },
  { group: 'acronym', tab: 'rooms', query: 'engplat', first: 'room:eng-platform' },
  { group: 'acronym', tab: 'rooms', query: 'devops', first: 'room:dev-ops' },
  {
    group: 'acronym',
    tab: 'users',
    query: 'js',
    shown: ['user:john', 'user:jon', 'user:johanna'],
    within: 3,
  },
  { group: 'acronym', tab: 'users', query: 'ew', first: 'user:emma' },
  { group: 'acronym', tab: 'users', query: 'ls', first: 'user:lisa' },
  { group: 'acronym', tab: 'users', query: 'jg', first: 'user:jose' },
  { group: 'acronym', tab: 'users', query: 'ce', first: 'user:chris' },
  { group: 'acronym', tab: 'users', query: 'ah', first: 'user:anne' },
  { group: 'acronym', tab: 'users', query: 'bs', first: 'user:bob' },
  { group: 'acronym', tab: 'users', query: 'jsmith', first: 'user:john' },
];

const typo: CorpusCase[] = [
  { group: 'typo', tab: 'actions', query: 'markdwon', first: 'setting:markdown' },
  { group: 'typo', tab: 'actions', query: 'setings', first: 'open-settings' },
  { group: 'typo', tab: 'actions', query: 'settigns', first: 'open-settings' },
  {
    group: 'typo',
    tab: 'actions',
    query: 'notifcation',
    first: [
      'setting:desktopNotifications',
      'setting:notificationSound',
      'setting:emailNotifications',
    ],
  },
  { group: 'typo', tab: 'actions', query: 'langauge', first: 'page-language' },
  { group: 'typo', tab: 'actions', query: 'thmee', first: 'page-theme' },
  { group: 'typo', tab: 'actions', query: 'logot', first: 'logout' },
  { group: 'typo', tab: 'actions', query: 'devloper', first: 'setting:developerTools' },
  { group: 'typo', tab: 'actions', query: 'dracla', first: 'theme:dracula' },
  { group: 'typo', tab: 'actions', query: 'tooggle', first: 'toggle-theme' },
  { group: 'typo', tab: 'actions', query: 'craete room', first: 'create-room' },
  { group: 'typo', tab: 'actions', query: 'zooom', first: 'setting:pageZoom' },
  { group: 'typo', tab: 'actions', query: 'acount', shown: ['setting:deactivateAccount'] },
  { group: 'typo', tab: 'actions', query: 'keybord', first: 'shortcut:help' },
  { group: 'typo', tab: 'actions', query: 'archvied', first: 'setting:archivedRooms' },
  { group: 'typo', tab: 'rooms', query: 'enginering', first: 'room:engineering' },
  { group: 'typo', tab: 'rooms', query: 'markting', first: 'room:marketing' },
  { group: 'typo', tab: 'rooms', query: 'desgin', first: 'room:design' },
  { group: 'typo', tab: 'rooms', query: 'relase', first: 'room:release-planning' },
  { group: 'typo', tab: 'rooms', query: 'genral', first: 'room:general' },
  {
    group: 'typo',
    tab: 'rooms',
    query: 'platfrom',
    shown: ['room:platform-reliability', 'room:eng-platform'],
    within: 2,
  },
  { group: 'typo', tab: 'rooms', query: 'anouncements', first: 'room:announcements' },
  { group: 'typo', tab: 'rooms', query: 'finanace', first: 'room:finance' },
  { group: 'typo', tab: 'rooms', query: 'jhonson', first: 'room:johnson-account' },
  { group: 'typo', tab: 'users', query: 'jhon', first: 'user:john' },
  { group: 'typo', tab: 'users', query: 'jonh', first: 'user:john' },
  { group: 'typo', tab: 'users', query: 'emmma', first: 'user:emma' },
  { group: 'typo', tab: 'users', query: 'chirs', first: 'user:chris' },
  { group: 'typo', tab: 'users', query: 'alcie', first: 'user:alice' },
  { group: 'typo', tab: 'users', query: 'watsno', first: 'user:emma' },
  { group: 'typo', tab: 'users', query: 'simspon', first: 'user:lisa' },
  { group: 'typo', tab: 'users', query: 'kierkegard', first: 'user:soren' },
  { group: 'typo', tab: 'threads', query: 'markdwon', first: 'thread:markdown-bug' },
  { group: 'typo', tab: 'threads', query: 'databse', first: 'thread:db-rollback' },
  { group: 'typo', tab: 'threads', query: 'piepline', first: 'thread:flaky' },
  // A short word takes no wrong letter: it would be another word.
  { group: 'typo', tab: 'actions', query: 'hime', absent: ['go-home'] },
  { group: 'typo', tab: 'users', query: 'lise', absent: ['user:lisa'] },
  { group: 'typo', tab: 'rooms', query: 'salt', absent: ['room:sales'] },
];

const accent: CorpusCase[] = [
  { group: 'accent', tab: 'users', query: 'jose', first: 'user:jose' },
  { group: 'accent', tab: 'users', query: 'garcia', first: 'user:jose' },
  { group: 'accent', tab: 'users', query: 'José', first: 'user:jose' },
  { group: 'accent', tab: 'users', query: 'zoe', first: 'user:zoe', shown: ['user:zoey'] },
  { group: 'accent', tab: 'users', query: 'ZOE', first: 'user:zoe' },
  { group: 'accent', tab: 'users', query: 'soren', first: 'user:soren' },
  { group: 'accent', tab: 'users', query: 'lukasz', first: 'user:lukasz' },
  { group: 'accent', tab: 'users', query: 'francois', first: 'user:francois' },
  { group: 'accent', tab: 'users', query: 'bjork', first: 'user:bjork' },
  { group: 'accent', tab: 'users', query: 'gudmundsdottir', first: 'user:bjork' },
  { group: 'accent', tab: 'users', query: 'muller', first: 'user:johan' },
  { group: 'accent', tab: 'users', query: 'renee', first: 'user:renee' },
  // The accented word is the word typed, so it goes above a longer word that starts the same.
  { group: 'accent', tab: 'rooms', query: 'cafe', first: 'room:cafe', shown: ['room:cafeteria'] },
  { group: 'accent', tab: 'rooms', query: 'café', first: 'room:cafe', shown: ['room:cafeteria'] },
  { group: 'accent', tab: 'threads', query: 'résumé', first: 'thread:resume' },
  { group: 'accent', tab: 'users', query: 'bjork gudmundsdottir', first: 'user:bjork' },
  { group: 'accent', tab: 'rooms', query: 'francais', first: 'room:cafe' },
  { group: 'accent', tab: 'rooms', query: 'zurich', first: 'room:zurich' },
  { group: 'accent', tab: 'rooms', query: 'munchen', first: 'room:munchen' },
  { group: 'accent', tab: 'rooms', query: 'buro', first: 'room:munchen' },
  { group: 'accent', tab: 'rooms', query: 'sao paulo', first: 'room:sao-paulo' },
  { group: 'accent', tab: 'threads', query: 'resume', first: 'thread:resume' },
  { group: 'accent', tab: 'actions', query: 'rose pine', first: 'theme:rosePine' },
  { group: 'accent', tab: 'actions', query: 'espanol', first: 'language:es' },
  { group: 'accent', tab: 'actions', query: 'francais', first: 'language:fr' },
  { group: 'accent', tab: 'actions', query: 'turkce', first: 'language:tr' },
  { group: 'accent', tab: 'actions', query: 'portugues', first: 'language:pt' },
  { group: 'accent', tab: 'actions', language: 'de', query: 'offnen', first: 'open-settings' },
  { group: 'accent', tab: 'actions', language: 'de', query: 'raume', first: 'setting:notifyRooms' },
  {
    group: 'accent',
    tab: 'actions',
    language: 'de',
    query: 'loschen',
    first: 'setting:deactivateAccount',
  },
];

const words: CorpusCase[] = [
  { group: 'words', tab: 'actions', query: 'create room', first: 'create-room' },
  { group: 'words', tab: 'actions', query: 'room create', first: 'create-room' },
  { group: 'words', tab: 'actions', query: 'open set', first: 'open-settings' },
  { group: 'words', tab: 'actions', query: 'settings open', first: 'open-settings' },
  { group: 'words', tab: 'actions', query: 'toggle theme', first: 'toggle-theme' },
  { group: 'words', tab: 'actions', query: 'quick tour', first: 'take-quick-tour' },
  { group: 'words', tab: 'actions', query: 'tour full', first: 'take-full-tour' },
  { group: 'words', tab: 'actions', query: 'page zoom', first: 'setting:pageZoom' },
  { group: 'words', tab: 'actions', query: 'zoom page', first: 'setting:pageZoom' },
  {
    group: 'words',
    tab: 'actions',
    query: 'notification sound',
    first: 'setting:notificationSound',
  },
  { group: 'words', tab: 'actions', query: 'sound notif', first: 'setting:notificationSound' },
  { group: 'words', tab: 'actions', query: 'url preview', first: 'setting:urlPreview' },
  { group: 'words', tab: 'actions', query: 'preview encrypted', first: 'setting:encUrlPreview' },
  { group: 'words', tab: 'actions', query: 'dark theme', shown: ['theme:dark'], within: 2 },
  { group: 'words', tab: 'actions', query: 'theme dracula', first: 'theme:dracula' },
  { group: 'words', tab: 'actions', query: 'copy link', first: 'copy-current-room-link' },
  { group: 'words', tab: 'actions', query: 'room settings', first: 'open-current-room-settings' },
  { group: 'words', tab: 'actions', query: 'mark read', first: 'mark-current-room-read' },
  { group: 'words', tab: 'actions', query: 'call research', first: 'call-agent:research' },
  { group: 'words', tab: 'actions', query: 'create zebra', empty: true },
  { group: 'words', tab: 'rooms', query: 'eng plat', first: 'room:eng-platform' },
  { group: 'words', tab: 'rooms', query: 'platform eng', first: 'room:eng-platform' },
  { group: 'words', tab: 'rooms', query: 'customer sup', first: 'room:customer-support' },
  { group: 'words', tab: 'rooms', query: 'support customer', first: 'room:customer-support' },
  { group: 'words', tab: 'rooms', query: 'design sys', first: 'room:design-system' },
  {
    group: 'words',
    tab: 'rooms',
    query: 'quarterly onboarding',
    first: 'room:onboarding-redesign',
  },
  { group: 'words', tab: 'rooms', query: 'weekly platform', first: 'room:weekly-sync' },
  { group: 'words', tab: 'rooms', query: 'engineering mindroom', first: 'room:engineering' },
  { group: 'words', tab: 'rooms', query: 'eng zebra', empty: true },
  { group: 'words', tab: 'users', query: 'john smith', first: 'user:john' },
  { group: 'words', tab: 'users', query: 'smith john', first: 'user:john' },
  { group: 'words', tab: 'users', query: 'emma w', first: 'user:emma' },
  { group: 'words', tab: 'users', query: 'j smith', first: 'user:john' },
  { group: 'words', tab: 'users', query: 'anne h', first: 'user:anne' },
  { group: 'words', tab: 'users', query: 'lisa simpson', first: 'user:lisa' },
  { group: 'words', tab: 'users', query: 'john zebra', empty: true },
  { group: 'words', tab: 'threads', query: 'login staging', first: 'thread:login' },
  { group: 'words', tab: 'threads', query: 'staging login', first: 'thread:login' },
  { group: 'words', tab: 'threads', query: 'markdown bug', first: 'thread:markdown-bug' },
  { group: 'words', tab: 'threads', query: 'rate limit', first: 'thread:rate-limits' },
  { group: 'words', tab: 'threads', query: 'migration rollback', first: 'thread:db-rollback' },
  { group: 'words', tab: 'threads', query: 'urgent login', first: 'thread:login' },
];

const scripts: CorpusCase[] = [
  { group: 'scripts', tab: 'rooms', query: '東京', first: 'room:tokyo' },
  { group: 'scripts', tab: 'rooms', query: 'オフィス', first: 'room:tokyo' },
  { group: 'scripts', tab: 'rooms', query: '開発', first: 'room:kaihatsu' },
  { group: 'scripts', tab: 'rooms', query: 'チーム', first: 'room:kaihatsu' },
  { group: 'scripts', tab: 'rooms', query: 'москва', first: 'room:moscow' },
  { group: 'scripts', tab: 'rooms', query: 'МОСКВА', first: 'room:moscow' },
  { group: 'scripts', tab: 'rooms', query: 'офис', first: 'room:moscow' },
  { group: 'scripts', tab: 'rooms', query: 'мосвка', first: 'room:moscow' },
  { group: 'scripts', tab: 'rooms', query: 'مكتب', first: 'room:dubai' },
  { group: 'scripts', tab: 'rooms', query: 'دبي', first: 'room:dubai' },
  { group: 'scripts', tab: 'rooms', query: 'חדר', first: 'room:tzevet' },
  { group: 'scripts', tab: 'rooms', query: 'צוות', first: 'room:tzevet' },
  { group: 'scripts', tab: 'rooms', query: '서울', first: 'room:seoul' },
  { group: 'scripts', tab: 'rooms', query: '사무실', first: 'room:seoul' },
  { group: 'scripts', tab: 'users', query: '田中', first: 'user:tanaka' },
  { group: 'scripts', tab: 'users', query: '太郎', first: 'user:tanaka' },
  { group: 'scripts', tab: 'users', query: '花子', first: 'user:yamada' },
  { group: 'scripts', tab: 'users', query: 'мария', first: 'user:maria' },
  { group: 'scripts', tab: 'users', query: 'иванова', first: 'user:maria' },
  { group: 'scripts', tab: 'users', query: 'محمد', first: 'user:mohamed' },
  { group: 'scripts', tab: 'users', query: 'علي', first: 'user:mohamed' },
  { group: 'scripts', tab: 'users', query: 'דוד', first: 'user:david' },
  { group: 'scripts', tab: 'users', query: 'כהן', first: 'user:david' },
  { group: 'scripts', tab: 'users', query: '김민준', first: 'user:minjun' },
  { group: 'scripts', tab: 'users', query: '민준', first: 'user:minjun' },
  { group: 'scripts', tab: 'threads', query: '東京', first: 'thread:tokyo-release' },
  { group: 'scripts', tab: 'threads', query: '計画', first: 'thread:tokyo-release' },
  { group: 'scripts', tab: 'actions', query: '日本語', first: 'language:ja' },
  { group: 'scripts', tab: 'actions', query: 'русский', first: 'language:ru' },
  { group: 'scripts', tab: 'actions', language: 'ja', query: '設定', first: 'open-settings' },
  { group: 'scripts', tab: 'actions', language: 'ja', query: 'テーマ', first: 'page-theme' },
  { group: 'scripts', tab: 'actions', language: 'ja', query: 'ログアウト', first: 'logout' },
  {
    group: 'scripts',
    tab: 'actions',
    language: 'ja',
    query: 'ルーム',
    shown: ['create-room'],
    within: 3,
  },
  {
    group: 'scripts',
    tab: 'actions',
    language: 'ja',
    query: '作成',
    first: ['create-room', 'create-space'],
  },
  {
    group: 'scripts',
    tab: 'actions',
    language: 'ja',
    query: '通知音',
    first: 'setting:notificationSound',
  },
  { group: 'scripts', tab: 'actions', language: 'ja', query: 'ダーク', first: 'theme:dark' },
  { group: 'scripts', tab: 'actions', language: 'ja', query: '言語', first: 'page-language' },
  {
    group: 'scripts',
    tab: 'actions',
    language: 'ja',
    query: 'マークダウン',
    first: 'setting:markdown',
  },
  { group: 'scripts', tab: 'actions', language: 'ja', query: 'ズーム', first: 'setting:pageZoom' },
  {
    group: 'scripts',
    tab: 'actions',
    language: 'de',
    query: 'einstellungen',
    first: 'open-settings',
  },
  {
    group: 'scripts',
    tab: 'actions',
    language: 'de',
    query: 'einstelungen',
    first: 'open-settings',
  },
  {
    group: 'scripts',
    tab: 'actions',
    language: 'de',
    query: 'raum erstellen',
    first: 'create-room',
  },
  {
    group: 'scripts',
    tab: 'actions',
    language: 'de',
    query: 'erstellen raum',
    first: 'create-room',
  },
  { group: 'scripts', tab: 'actions', language: 'de', query: 'abmelden', first: 'logout' },
  { group: 'scripts', tab: 'actions', language: 'de', query: 'design', first: 'page-theme' },
  { group: 'scripts', tab: 'actions', language: 'de', query: 'sprache', first: 'page-language' },
  { group: 'scripts', tab: 'actions', language: 'de', query: 'dunkel', first: 'theme:dark' },
  { group: 'scripts', tab: 'actions', language: 'de', query: 'zoom', first: 'setting:pageZoom' },
  {
    group: 'scripts',
    tab: 'actions',
    language: 'de',
    query: 'markdwon',
    first: 'setting:markdown',
  },
  {
    group: 'scripts',
    tab: 'actions',
    language: 'de',
    query: 'benachrichtigungston',
    first: 'setting:notificationSound',
  },
  ...['john', 'lisa', 'emma'].flatMap((query): CorpusCase[] => [
    { group: 'scripts', tab: 'actions', language: 'de', query, empty: true },
    { group: 'scripts', tab: 'actions', language: 'ja', query, empty: true },
  ]),
];

const all: CorpusCase[] = [
  { group: 'all', tab: 'all', query: 'general', first: 'room:general' },
  { group: 'all', tab: 'all', query: 'engineering', first: 'room:engineering' },
  { group: 'all', tab: 'all', query: 'sales', first: 'room:sales' },
  { group: 'all', tab: 'all', query: 'roadmap', first: 'room:product-roadmap' },
  { group: 'all', tab: 'all', query: 'zurich', first: 'room:zurich' },
  { group: 'all', tab: 'all', query: '東京', first: 'room:tokyo' },
  { group: 'all', tab: 'all', query: 'enginering', first: 'room:engineering' },
  {
    group: 'all',
    tab: 'all',
    query: 'support',
    first: ['room:support-escalations', 'room:customer-support'],
  },
  { group: 'all', tab: 'all', query: 'john smith', first: 'user:john' },
  { group: 'all', tab: 'all', query: 'emma watson', first: 'user:emma' },
  { group: 'all', tab: 'all', query: 'lisa simpson', first: 'user:lisa' },
  { group: 'all', tab: 'all', query: 'jhon', shown: ['user:john'], absent: ['user:jon'] },
  { group: 'all', tab: 'all', query: '田中', first: 'user:tanaka' },
  { group: 'all', tab: 'all', query: 'flaky', first: 'thread:flaky' },
  { group: 'all', tab: 'all', query: 'login staging', first: 'thread:login' },
  { group: 'all', tab: 'all', query: 'dracula', first: 'theme:dracula' },
  { group: 'all', tab: 'all', query: 'nord', first: 'theme:nord' },
  { group: 'all', tab: 'all', query: 'dark', first: 'theme:dark' },
  { group: 'all', tab: 'all', query: 'logout', first: 'logout' },
  { group: 'all', tab: 'all', query: 'settings', first: 'open-settings' },
  { group: 'all', tab: 'all', query: 'theme', first: 'page-theme' },
  { group: 'all', tab: 'all', query: 'create room', first: 'create-room' },
  { group: 'all', tab: 'all', query: 'toggle theme', first: 'toggle-theme' },
  { group: 'all', tab: 'all', query: 'page zoom', first: 'setting:pageZoom' },
  { group: 'all', tab: 'all', query: 'go home', first: 'go-home' },
  { group: 'all', tab: 'all', query: 'crm', first: 'create-room' },
  { group: 'all', tab: 'all', query: 'gh', first: 'go-home' },
  { group: 'all', tab: 'all', query: 'pz', first: 'setting:pageZoom' },
  { group: 'all', tab: 'all', query: 'mf', first: 'setting:markdown' },
  { group: 'all', tab: 'all', query: 'call code', first: 'call-agent:code' },
  {
    group: 'all',
    tab: 'all',
    query: 'compact',
    first: ['message-layout:compact', 'room-command:viewSwitch'],
  },
  {
    group: 'all',
    tab: 'all',
    query: 'markdown',
    first: ['thread:markdown-bug', 'setting:markdown'],
    shown: ['thread:markdown-bug', 'setting:markdown'],
  },
  {
    group: 'all',
    tab: 'all',
    query: 'markdwon',
    first: ['thread:markdown-bug', 'setting:markdown'],
    shown: ['thread:markdown-bug', 'setting:markdown'],
  },
  { group: 'all', tab: 'all', query: 'notification sound', shown: ['setting:notificationSound'] },
  { group: 'all', tab: 'all', query: 'room', shown: ['create-room', 'room:space-mindroom'] },
  // All shows three rows of actions, settings and choices together. A word many of them hold
  // shows the actions people use daily; the setting is on the Actions tab.
  {
    group: 'all',
    tab: 'all',
    query: 'room',
    shown: ['create-room', 'mark-current-room-read', 'copy-current-room-link'],
    absent: ['setting:archivedRooms'],
  },
  { group: 'all', tab: 'actions', query: 'room', shown: ['setting:archivedRooms'] },
  {
    group: 'all',
    tab: 'all',
    query: 'theme',
    shown: ['page-theme', 'toggle-theme'],
    within: 2,
    absent: ['theme:'],
  },
  { group: 'all', tab: 'all', query: 'settings', shown: ['open-current-room-settings'], within: 2 },
  // A setting or a choice named by the text keeps its row against actions that only hold a
  // word of it, mention it in their description, or resemble it.
  { group: 'all', tab: 'all', query: 'archived rooms', first: 'setting:archivedRooms' },
  { group: 'all', tab: 'all', query: 'archived', first: 'setting:archivedRooms' },
  { group: 'all', tab: 'all', query: 'hide membership', first: 'setting:hideMembershipEvents' },
  { group: 'all', tab: 'all', query: 'markdown formatting', first: 'setting:markdown' },
  { group: 'all', tab: 'all', query: 'developer tools', first: 'setting:developerTools' },
  { group: 'all', tab: 'all', query: 'zoom', first: 'setting:pageZoom' },
  { group: 'all', tab: 'all', query: 'url preview', first: 'setting:urlPreview' },
  { group: 'all', tab: 'all', query: 'bubble', first: 'message-layout:bubble' },
  { group: 'all', tab: 'all', query: 'light', first: 'theme:light' },
  { group: 'all', tab: 'all', query: 'tool calls', shown: ['setting:showToolCalls'], within: 2 },
  {
    group: 'all',
    tab: 'all',
    query: 'notif',
    shown: [
      'setting:notificationSound',
      'setting:desktopNotifications',
      'setting:emailNotifications',
    ],
  },
  // An action named by the text stays above a setting that holds it.
  { group: 'all', tab: 'all', query: 'create space', first: 'create-space' },
  {
    group: 'all',
    tab: 'actions',
    query: 'create space',
    before: [['create-space', 'setting:sidebarCreateSpace']],
    shown: ['setting:sidebarCreateSpace'],
  },
  {
    group: 'all',
    tab: 'actions',
    query: 'show tool calls',
    shown: ['room-command:toolCalls', 'setting:showToolCalls'],
    within: 2,
  },
  {
    group: 'all',
    tab: 'all',
    query: 'design',
    first: 'room:design',
    shown: ['room:design-system'],
  },
  { group: 'all', tab: 'all', query: 'plan', shown: ['room:release-planning', 'thread:q3'] },
];

const fields: CorpusCase[] = [
  { group: 'fields', tab: 'actions', query: 'sign out', first: 'logout' },
  { group: 'fields', tab: 'actions', query: 'preferences', first: 'open-settings' },
  { group: 'fields', tab: 'actions', query: 'inbox', first: 'go-activity' },
  { group: 'fields', tab: 'actions', query: 'new room', first: 'create-room' },
  { group: 'fields', tab: 'actions', query: 'share', first: 'copy-current-room-link' },
  { group: 'fields', tab: 'actions', query: 'done', first: 'resolve-current-thread' },
  {
    group: 'fields',
    tab: 'actions',
    query: 'tutorial',
    shown: ['take-quick-tour', 'take-full-tour'],
    within: 2,
  },
  { group: 'fields', tab: 'actions', query: 'locale', first: 'page-language' },
  { group: 'fields', tab: 'actions', query: 'colors', first: 'page-theme' },
  { group: 'fields', tab: 'actions', query: 'font size', first: 'setting:pageZoom' },
  {
    group: 'fields',
    tab: 'actions',
    query: 'debug',
    first: 'setting:debugMode',
    shown: ['setting:developerTools', 'setting:showHiddenEvents'],
    within: 3,
  },
  { group: 'fields', tab: 'actions', query: 'crash', first: 'setting:errorReports' },
  { group: 'fields', tab: 'actions', query: 'block', first: 'setting:blockedUsers' },
  {
    group: 'fields',
    tab: 'actions',
    query: 'links',
    first: ['setting:urlPreview', 'setting:encUrlPreview'],
  },
  // A title that holds the text goes above rows that hold it only in their search words.
  {
    group: 'fields',
    tab: 'actions',
    query: 'theme',
    before: [
      ['page-theme', 'toggle-theme'],
      ['toggle-theme', 'theme:dark'],
    ],
  },
  {
    group: 'fields',
    tab: 'rooms',
    query: 'platform',
    shown: ['room:platform-reliability', 'room:eng-platform'],
    within: 2,
    before: [['room:eng-platform', 'room:weekly-sync']],
  },
  { group: 'fields', tab: 'rooms', query: 'platform', shown: ['room:weekly-sync'] },
  { group: 'fields', tab: 'rooms', query: 'mindroom', shown: ['room:engineering'] },
  {
    group: 'fields',
    tab: 'rooms',
    query: 'mindroom',
    before: [
      ['room:space-mindroom', 'room:engineering'],
      ['room:mindroom-dev', 'room:engineering'],
    ],
  },
  { group: 'fields', tab: 'rooms', query: '#eng-platform', first: 'room:eng-platform' },
  { group: 'fields', tab: 'rooms', query: 'incidents', first: 'room:platform-reliability' },
  {
    group: 'fields',
    tab: 'rooms',
    query: 'customer',
    first: 'room:customer-support',
    before: [['room:onboarding-redesign', 'room:support-escalations']],
  },
  { group: 'fields', tab: 'threads', query: 'urgent', first: 'thread:login' },
  { group: 'fields', tab: 'threads', query: 'ci', first: 'thread:flaky' },
  {
    group: 'fields',
    tab: 'threads',
    query: 'frontend',
    shown: ['thread:markdown-bug', 'thread:room-list', 'thread:create-room-dialog'],
  },
  { group: 'fields', tab: 'users', query: '@john', first: 'user:john' },
  { group: 'fields', tab: 'users', query: '@john:example.org', first: 'user:john' },
  { group: 'fields', tab: 'users', query: 'matrix.org', first: 'user:dmitri' },
  { group: 'fields', tab: 'users', query: 'jschmidt', first: 'user:johanna' },
  { group: 'fields', tab: 'users', query: 'fdupont', first: 'user:francois' },
  { group: 'fields', tab: 'users', query: 'code', first: 'user:code' },
  { group: 'fields', tab: 'users', query: 'research', first: 'user:research' },
  { group: 'fields', tab: 'users', query: 'mindroom_code', first: 'user:code' },
  // Every agent's user name starts with "mindroom_", so that start finds none of them.
  { group: 'fields', tab: 'users', query: 'mind', absent: ['user:code', 'user:research'] },
];

/** Every case, in the order the report lists its groups. */
export const SEARCH_CORPUS: readonly CorpusCase[] = [
  ...names,
  ...prefix,
  ...acronym,
  ...typo,
  ...accent,
  ...words,
  ...scripts,
  ...all,
  ...fields,
];

/** The rows of one section of a tab, in the order shown. */
export type CorpusSection = { id: string; rows: string[] };

/** What decides whether `rows`, the IDs a tab shows in order, are what `testCase` expects. */
export const checkCorpusCase = (testCase: CorpusCase, rows: readonly string[]): string[] => {
  const failures: string[] = [];
  const names_ = (id: string) => (row: string) =>
    id.endsWith(':') ? row.startsWith(id) : row === id;
  const indexOf = (id: string) => rows.findIndex(names_(id));
  const { first, shown, within, before, absent, empty } = testCase;
  if (first !== undefined) {
    const wanted = Array.isArray(first) ? first : [first];
    if (!wanted.includes(rows[0] ?? '')) {
      failures.push(`first is ${rows[0] ?? 'nothing'}, not ${wanted.join(' or ')}`);
    }
  }
  shown?.forEach((id) => {
    const index = indexOf(id);
    if (index === -1) failures.push(`${id} is not shown`);
    else if (within !== undefined && index >= within) {
      failures.push(`${id} is row ${index + 1}, not within ${within}`);
    }
  });
  before?.forEach(([upper, lower]) => {
    const lowerIndex = indexOf(lower);
    if (lowerIndex === -1) return;
    const upperIndex = indexOf(upper);
    if (upperIndex === -1 || upperIndex > lowerIndex)
      failures.push(`${upper} is not above ${lower}`);
  });
  absent?.forEach((id) => {
    const index = indexOf(id);
    if (index !== -1) failures.push(`${rows[index] ?? id} is shown`);
  });
  if (empty && rows.length > 0) failures.push(`shows ${rows.slice(0, 3).join(', ')}`);
  return failures;
};
