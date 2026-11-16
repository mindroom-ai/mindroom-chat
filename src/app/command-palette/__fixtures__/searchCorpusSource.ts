import type { TFunction } from 'i18next';
import englishCatalog, { mergeLocaleTrees, type LocaleTree } from '../../i18n/englishResources';
import { APP_LANGUAGES } from '../../i18n/i18nLanguages';
import de from '../../i18n/locales/de.json';
import deAdditions from '../../i18n/locales/additions/de.json';
import ja from '../../i18n/locales/ja.json';
import jaAdditions from '../../i18n/locales/additions/ja.json';
import { DEFAULT_SETTINGS } from '../../preferences/settings';
import {
  getShownSettings,
  type SettingDefinition,
  type SettingsContext,
} from '../../preferences/settingsRegistry';
import { DARK_THEME_NAMES, LIGHT_THEME_NAMES } from '../../preferences/themeNames';
import type { SettingsSearchValues, SettingsTranslate } from '../../settings/settingsSearchIndex';
import { SHORTCUTS } from '../../shortcuts/shortcuts';
import { getCommandPaletteQuickActions } from '../commandPaletteActions';
import { getCommandPalettePageRows, tagCommandPalettePageRows } from '../commandPalettePages';
import { getCommandPaletteSettingRows } from '../commandPaletteSettings';
import type {
  CommandPaletteActionItem,
  CommandPaletteRoomItem,
  CommandPaletteThreadItem,
  CommandPaletteUserItem,
} from '../commandPaletteTypes';

/** The app languages the corpus runs in: English, one more Latin one, one in another script. */
export type CorpusLanguage = 'en' | 'de' | 'ja';

const CATALOGS: Record<CorpusLanguage, LocaleTree> = {
  en: englishCatalog,
  de: mergeLocaleTrees(de, deAdditions),
  ja: mergeLocaleTrees(ja, jaAdditions),
};

const lookUp = (tree: LocaleTree, key: string): string | undefined => {
  const value = key
    .split('.')
    .reduce<LocaleTree | string | undefined>(
      (node, part) => (typeof node === 'object' ? node[part] : undefined),
      tree
    );
  return typeof value === 'string' ? value : undefined;
};

/** The app's text for a key in `language`, or the English one where it has none, as the app falls back. */
const translator =
  (language: CorpusLanguage) =>
  (key: string, values?: Record<string, unknown>): string =>
    (lookUp(CATALOGS[language], key) ?? lookUp(englishCatalog, key) ?? key).replace(
      /\{\{(\w+)\}\}/g,
      (placeholder, name: string) => (values && name in values ? String(values[name]) : placeholder)
    );

// What a signed-in account on the web sees.
const SETTINGS_CONTEXT: SettingsContext = {
  native: false,
  nativeIOS: false,
  localMindroom: true,
  serverAdmin: false,
  useSystemTheme: true,
  developerTools: false,
  errorReporting: true,
  railButtons: { threads: true, explore: true, createSpace: true, search: true },
};

const SEARCH_VALUES: SettingsSearchValues = {
  userId: '@me:example.org',
  username: 'me',
  sendKey: 'Ctrl',
  shortcut: 'Ctrl+K',
};

const LAYOUTS = ['modern', 'compact', 'bubble'] as const;

type RoomOptions = Partial<
  Pick<CommandPaletteRoomItem, 'kind' | 'topic' | 'canonicalAlias' | 'parentNames' | 'boost'>
>;

const ROOMS: readonly (readonly [string, string, RoomOptions?])[] = [
  ['general', 'General', { topic: 'Team chat and announcements', boost: 15 }],
  ['engineering', 'Engineering', { topic: 'Code, reviews and deploys', parentNames: ['MindRoom'] }],
  ['product-roadmap', 'Product Roadmap', { topic: 'Quarterly planning' }],
  ['design', 'Design', { topic: 'Product design reviews' }],
  [
    'eng-platform',
    'Engineering Platform',
    {
      topic: 'Build system and CI',
      canonicalAlias: '#eng-platform:example.org',
      parentNames: ['Engineering Space'],
    },
  ],
  ['random', 'Random', { topic: 'Off topic' }],
  ['customer-support', 'Customer Support', { topic: 'Tickets from customers' }],
  ['marketing', 'Marketing', { topic: 'Campaigns and launch plans' }],
  ['platform-reliability', 'Platform Reliability', { topic: 'Incidents and on-call' }],
  ['design-system', 'Design System', { topic: 'Components and tokens' }],
  ['release-planning', 'Release Planning', { topic: 'What ships when' }],
  ['support-escalations', 'Support Escalations', { topic: 'Urgent customer issues' }],
  ['sales', 'Sales', { topic: 'Deals and pipeline' }],
  ['data-science', 'Data Science', { topic: 'Models and notebooks' }],
  ['database-migration', 'Database Migration', { topic: 'Moving to the new cluster' }],
  ['weekly-sync', 'Weekly Sync', { topic: 'Agenda for the platform crew' }],
  ['book-club', 'Book Club'],
  ['frontend', 'Frontend', { topic: 'Web client' }],
  ['backend', 'Backend', { topic: 'Services and APIs' }],
  ['dev-ops', 'dev-ops', { canonicalAlias: '#devops:example.org' }],
  ['mindroom-dev', 'mindroom-dev', { topic: 'Development of MindRoom' }],
  ['hr', 'HR & People', { topic: 'Hiring and onboarding' }],
  ['finance', 'Finance'],
  ['legal', 'Legal'],
  ['announcements', 'Announcements'],
  ['watercooler', 'Watercooler'],
  ['onboarding-redesign', 'Quarterly planning for the customer onboarding redesign'],
  ['johnson-account', 'Johnson Account', { topic: 'Customer: Johnson & Sons' }],
  ['cafeteria', 'Cafeteria Menu'],
  ['cafe', 'Café Français', { topic: 'On parle français ici' }],
  ['zurich', 'Zürich Office'],
  ['munchen', 'München Büro'],
  ['sao-paulo', 'São Paulo'],
  ['tokyo', '東京オフィス', { topic: '東京チームの連絡' }],
  ['kaihatsu', '開発チーム', { topic: 'コードレビュー' }],
  ['moscow', 'Москва офис'],
  ['dubai', 'مكتب دبي'],
  ['tzevet', 'חדר צוות'],
  ['seoul', '서울 사무실'],
  ['space-mindroom', 'MindRoom', { kind: 'space' }],
  ['space-engineering', 'Engineering Space', { kind: 'space', topic: 'Nested engineering rooms' }],
];

// Name, user ID, and the boost of an open direct chat (10) or a seat in the open room (5).
const PEOPLE: readonly (readonly [string, string, string, number?])[] = [
  ['john', 'John Smith', '@john:example.org', 10],
  ['johnny', 'Johnny Appleseed', '@johnny:example.org'],
  ['jon', 'Jon Snow', '@jon.snow:example.org'],
  ['joan', 'Joan Jett', '@joan:example.org'],
  ['johan', 'Johan Müller', '@johan:example.org'],
  ['johanna', 'Johanna Schmidt', '@jschmidt:example.org'],
  ['lisa', 'Lisa Simpson', '@lisa:example.org', 10],
  ['elisa', 'Elisa Lam', '@elisa:example.org'],
  ['alisa', 'Alisa Petrova', '@alisa:example.org'],
  ['emma', 'Emma Watson', '@emma:example.org', 10],
  ['emmanuel', 'Emmanuel Macron', '@emmanuel:example.org'],
  ['gemma', 'Gemma Chan', '@gemma:example.org'],
  ['emily', 'Emily Clarke', '@emily:example.org'],
  ['jose', 'José García', '@jgarcia:example.org'],
  ['zoey', 'Zoey Deutch', '@zoey:example.org'],
  ['zoe', 'Zoë Kravitz', '@zkravitz:example.org'],
  ['soren', 'Søren Kierkegaard', '@soren:example.org'],
  ['lukasz', 'Łukasz Kowalski', '@lukasz:example.org'],
  ['francois', 'François Dupont', '@fdupont:example.org'],
  ['bjork', 'Björk Guðmundsdóttir', '@bjork:example.org'],
  ['renee', 'Renée Zellweger', '@renee:example.org'],
  ['tanaka', '田中太郎', '@tanaka:example.org'],
  ['yamada', '山田花子', '@hanako:example.org'],
  ['minjun', '김민준', '@minjun:example.org'],
  ['maria', 'Мария Иванова', '@maria:example.org'],
  ['mohamed', 'محمد علي', '@mohamed:example.org'],
  ['david', 'דוד כהן', '@david:example.org'],
  ['anna', 'Anna Lee', '@anna:example.org'],
  ['anne', 'Anne Hathaway', '@anne:example.org'],
  ['anton', 'Anton Nilsson', '@anton:example.org'],
  ['hannah', 'Hannah Arendt', '@hannah:example.org'],
  ['alice', 'Alice Johnson', '@alice:example.org', 5],
  ['bob', 'Bob Stone', '@bob:example.org'],
  ['chris', 'Chris Evans', '@chris:example.org'],
  ['christina', 'Christina Aguilera', '@christina:example.org'],
  ['christopher', 'Christopher Nolan', '@cnolan:example.org'],
  ['code', 'Code', '@mindroom_code:example.org', 5],
  ['research', 'Research', '@mindroom_research:example.org', 5],
  ['router', 'Router', '@mindroom_router:example.org', 5],
  ['dmitri', 'dmitri', '@dmitri:matrix.org'],
];

// Summary, room, tags.
const THREADS: readonly (readonly [string, string, string, string[]?])[] = [
  ['login', 'Investigate login issue on staging', 'Engineering', ['urgent']],
  ['markdown-bug', 'Markdown rendering bug in code blocks', 'Frontend'],
  ['q3', 'Plan the Q3 roadmap', 'Product Roadmap'],
  ['room-list', 'Room list performance', 'Frontend'],
  ['theme-contrast', 'Theme contrast in dark mode', 'Design'],
  ['onboarding', 'Onboarding checklist for new hires', 'HR & People'],
  ['db-rollback', 'Database migration rollback', 'Database Migration'],
  ['flaky', 'Deploy pipeline is flaky', 'Engineering Platform', ['ci']],
  ['resume', 'Résumé screening process', 'HR & People'],
  ['rate-limits', 'API rate limits for the public endpoint', 'Backend'],
  ['create-room-dialog', 'Create room dialog loses focus', 'Frontend', ['bug']],
  ['john-access', "John's access request", 'General'],
  ['tokyo-release', '東京リリースの計画', '東京オフィス'],
  ['sound', 'Notification sound not playing', 'Support Escalations'],
  ['invoice', 'Invoice template for Johnson Account', 'Sales'],
  ['standup', 'Standup notes', 'Weekly Sync'],
];

const rooms: CommandPaletteRoomItem[] = ROOMS.map(([slug, name, options], index) => ({
  id: `room:${slug}`,
  kind: 'room',
  name,
  // Activity order, as the palette's source ranks rooms.
  sortRank: ROOMS.length - index,
  ...options,
}));

const users: CommandPaletteUserItem[] = PEOPLE.map(([slug, displayName, userId, boost]) => ({
  id: `user:${slug}`,
  kind: 'user',
  displayName,
  userId,
  localpart: userId.slice(1, userId.indexOf(':')),
  boost: boost ?? 0,
}));

const threads: CommandPaletteThreadItem[] = THREADS.map(
  ([slug, summaryText, roomName, tags], index) => ({
    id: `thread:${slug}`,
    kind: 'thread',
    roomId: `!${roomName}:example.org`,
    threadId: `$${slug}`,
    summaryText,
    roomName,
    tags,
    sortRank: THREADS.length - index,
  })
);

/** What the palette of a signed-in account holds, in one app language. */
export type CorpusSource = {
  t: SettingsTranslate;
  searchValues: SettingsSearchValues;
  shownSettings: SettingDefinition[];
  /** The rows of the Actions tab before anything is typed. */
  actions: CommandPaletteActionItem[];
  /** A row per setting, found by typing. */
  settingRows: CommandPaletteActionItem[];
  /** The choices of the Theme, Message Layout and App Language pages, tagged with their page. */
  choiceRows: CommandPaletteActionItem[];
  rooms: CommandPaletteRoomItem[];
  threads: CommandPaletteThreadItem[];
  users: CommandPaletteUserItem[];
};

const buildSource = (language: CorpusLanguage): CorpusSource => {
  const translate = translator(language);
  const t = translate as SettingsTranslate;
  const shownSettings = getShownSettings(SETTINGS_CONTEXT);

  // A room and a thread are open, so every action the palette can offer is listed.
  const quickActions = getCommandPaletteQuickActions(
    { currentRoomName: 'General', currentThreadId: '$login', isCurrentThreadResolved: false },
    translate as TFunction
  );
  const callRows = ['code', 'research'].map(
    (agent): CommandPaletteActionItem => ({
      id: `call-agent:${agent}`,
      kind: 'action',
      title: translate('mindroomUi.calls.agentCallHeaderButton.callAgent', {
        name: agent === 'code' ? 'Code' : 'Research',
      }),
      description: 'General',
      keywords: ['voice', 'agent'],
      sortRank: 75,
    })
  );
  const roomCommandRows = (
    [
      ['viewSwitch', 'mindroomUi.threads.mindroomRoomViewHeader.compactView'],
      ['toolCalls', 'mindroomUi.messages.showToolCalls'],
    ] as const
  ).map(
    ([id, key]): CommandPaletteActionItem => ({
      id: `room-command:${id}`,
      kind: 'action',
      title: translate(key),
      description: 'General',
      sortRank: 45,
    })
  );
  const shortcutRows = (
    [
      ['help', 15],
      ['nextUnread', 14],
      ['previousUnread', 13],
      ['roomList', 12],
    ] as const
  ).map(
    ([id, sortRank]): CommandPaletteActionItem => ({
      id: `shortcut:${id}`,
      kind: 'action',
      title: translate(SHORTCUTS[id].labelKey),
      sortRank,
    })
  );

  const themeRows = getCommandPalettePageRows(
    'theme',
    [...LIGHT_THEME_NAMES, ...DARK_THEME_NAMES].map((name) => ({
      value: name,
      title: translate(`options.themeName.${name}`),
      current: name === 'light',
    }))
  );
  const layoutRows = getCommandPalettePageRows(
    'message-layout',
    LAYOUTS.map((layout) => ({
      value: layout,
      title: translate(`options.messageLayout.${layout}`),
      current: layout === 'modern',
    }))
  );
  const languageRows = getCommandPalettePageRows(
    'language',
    APP_LANGUAGES.map(({ code, nativeName }) => ({
      value: code,
      title: nativeName,
      lang: code,
      current: code === language,
    }))
  );

  return {
    t,
    searchValues: SEARCH_VALUES,
    shownSettings,
    actions: [...quickActions, ...callRows, ...roomCommandRows, ...shortcutRows],
    settingRows: getCommandPaletteSettingRows(
      shownSettings,
      DEFAULT_SETTINGS,
      t,
      SEARCH_VALUES
    ).map(({ item }) => item),
    choiceRows: [
      ...tagCommandPalettePageRows(translate('settings.general.appearance.theme'), themeRows),
      ...tagCommandPalettePageRows(
        translate('settings.general.messages.messageLayout'),
        layoutRows
      ),
      ...tagCommandPalettePageRows(
        translate('settings.general.language.appLanguage'),
        languageRows
      ),
    ],
    rooms,
    threads,
    users,
  };
};

const sources = new Map<CorpusLanguage, CorpusSource>();

/** The corpus fixture in `language`: one object per language, so search indexes are reused. */
export const getCorpusSource = (language: CorpusLanguage): CorpusSource => {
  const cached = sources.get(language);
  if (cached) return cached;
  const source = buildSource(language);
  sources.set(language, source);
  return source;
};
