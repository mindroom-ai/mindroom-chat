import { Icons } from 'folds';
import { type TFunction } from 'i18next';
import {
  getDirectPath,
  getHomePath,
  getHomeSearchPath,
  getActivityPath,
} from '../routes/pathUtils';
import { COMMAND_PALETTE_PAGE_ICONS } from './commandPalettePages';
import type { CommandPaletteActionItem } from './commandPaletteTypes';

export type CommandPaletteQuickActionId =
  | 'open-settings'
  | 'take-quick-tour'
  | 'take-full-tour'
  | 'go-home'
  | 'go-direct'
  | 'go-activity'
  | 'create-room'
  | 'create-space'
  | 'mark-current-room-read'
  | 'copy-current-room-link'
  | 'open-current-room-settings'
  | 'resolve-current-thread'
  | 'unresolve-current-thread'
  | 'toggle-theme'
  | 'page-theme'
  | 'page-message-layout'
  | 'page-language'
  | 'logout';

export type CommandPaletteQuickActionContext = {
  currentRoomName?: string;
  currentThreadId?: string;
  isCurrentThreadResolved?: boolean;
  isCurrentThreadPinned?: boolean;
};

const buildPathWithSearch = (
  path: string,
  searchParams: Record<string, string | undefined>
): string => {
  const params = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    if (typeof value === 'string' && value.length > 0) {
      params.set(key, value);
    }
  });

  const search = params.toString();
  return search.length > 0 ? `${path}?${search}` : path;
};

const actionItem = (
  id: CommandPaletteQuickActionId,
  title: string,
  sortRank: number,
  options?: Pick<
    CommandPaletteActionItem,
    'description' | 'keywords' | 'icon' | 'shortcut' | 'page'
  >
): CommandPaletteActionItem => ({
  id,
  kind: 'action',
  title,
  sortRank,
  ...options,
});

export const getCommandPaletteQuickActions = (
  {
    currentRoomName,
    currentThreadId,
    isCurrentThreadResolved,
    isCurrentThreadPinned,
  }: CommandPaletteQuickActionContext,
  t: TFunction
): CommandPaletteActionItem[] => {
  const roomLabel = currentRoomName ?? t('commandPalette.actions.currentRoomFallback');
  // The interface tour in both of its levels, found by the same words. It ranks below what people
  // do every day, so the actions the palette shows before anything is typed stay those.
  const tour = {
    description: t('tour.entries.paletteDescription'),
    keywords: ['help', 'tutorial', 'guide', 'threads', 'onboarding'],
    icon: Icons.Info,
  };
  const actions: CommandPaletteActionItem[] = [
    actionItem('open-settings', t('commandPalette.actions.openSettings'), 130, {
      description: t('commandPalette.actions.openSettingsDescription'),
      keywords: ['preferences'],
      icon: Icons.Setting,
      shortcut: 'settings',
    }),
    actionItem('go-home', t('commandPalette.actions.goHome'), 120, {
      description: t('commandPalette.actions.goHomeDescription'),
      keywords: ['rooms'],
      icon: Icons.Home,
    }),
    actionItem('go-direct', t('commandPalette.actions.goDirect'), 110, {
      description: t('commandPalette.actions.goDirectDescription'),
      keywords: ['dm', 'messages'],
      icon: Icons.Message,
    }),
    actionItem('go-activity', t('commandPalette.actions.goActivity'), 100, {
      description: t('commandPalette.actions.goActivityDescription'),
      keywords: ['inbox', 'invites', 'notifications', 'mentions'],
      icon: Icons.Bell,
    }),
    actionItem('create-room', t('commandPalette.actions.createRoom'), 90, {
      description: t('commandPalette.actions.createRoomDescription'),
      keywords: ['new room'],
      icon: Icons.HashPlus,
    }),
    actionItem('create-space', t('commandPalette.actions.createSpace'), 80, {
      description: t('commandPalette.actions.createSpaceDescription'),
      keywords: ['new space'],
      icon: Icons.SpacePlus,
    }),
    actionItem('page-theme', t('settings.general.appearance.theme'), 25, {
      keywords: ['appearance', 'dark', 'light', 'colors'],
      icon: COMMAND_PALETTE_PAGE_ICONS.theme,
      page: 'theme',
    }),
    actionItem('toggle-theme', t('commandPalette.actions.toggleTheme'), 20, {
      description: t('commandPalette.actions.toggleThemeDescription'),
      keywords: ['appearance'],
      icon: Icons.Sun,
    }),
    actionItem('page-message-layout', t('settings.general.messages.messageLayout'), 18, {
      keywords: ['modern', 'compact', 'bubble'],
      icon: COMMAND_PALETTE_PAGE_ICONS['message-layout'],
      page: 'message-layout',
    }),
    actionItem('page-language', t('settings.general.language.appLanguage'), 17, {
      keywords: ['locale', 'translation'],
      icon: COMMAND_PALETTE_PAGE_ICONS.language,
      page: 'language',
    }),
    actionItem('take-quick-tour', t('tour.entries.paletteQuick'), 16, tour),
    actionItem('take-full-tour', t('tour.entries.paletteFull'), 13, tour),
    actionItem('logout', t('commandPalette.actions.logout'), 10, {
      description: t('commandPalette.actions.logoutDescription'),
      keywords: ['sign out'],
      icon: Icons.Power,
    }),
  ];

  if (currentRoomName) {
    actions.splice(
      6,
      0,
      actionItem('mark-current-room-read', t('commandPalette.actions.markCurrentRoomRead'), 70, {
        description: t('commandPalette.actions.markCurrentRoomReadDescription', {
          room: roomLabel,
        }),
        keywords: ['read', 'unread'],
        icon: Icons.CheckTwice,
      }),
      actionItem('copy-current-room-link', t('commandPalette.actions.copyCurrentRoomLink'), 60, {
        description: t('commandPalette.actions.copyCurrentRoomLinkDescription', {
          room: roomLabel,
        }),
        keywords: ['share', 'link'],
        icon: Icons.Link,
      }),
      actionItem(
        'open-current-room-settings',
        t('commandPalette.actions.openCurrentRoomSettings'),
        50,
        {
          description: t('commandPalette.actions.openCurrentRoomSettingsDescription', {
            room: roomLabel,
          }),
          keywords: ['room settings'],
          icon: Icons.Setting,
        }
      )
    );
  }

  if (currentThreadId && !isCurrentThreadPinned) {
    actions.splice(
      actions.findIndex((item) => item.id === 'page-theme'),
      0,
      isCurrentThreadResolved
        ? actionItem(
            'unresolve-current-thread',
            t('commandPalette.actions.unresolveCurrentThread'),
            40,
            {
              description: t('commandPalette.actions.unresolveCurrentThreadDescription'),
              keywords: ['thread', 'reopen'],
              icon: Icons.Check,
              shortcut: 'resolveThread',
            }
          )
        : actionItem(
            'resolve-current-thread',
            t('commandPalette.actions.resolveCurrentThread'),
            40,
            {
              description: t('commandPalette.actions.resolveCurrentThreadDescription'),
              keywords: ['thread', 'done'],
              icon: Icons.Check,
              shortcut: 'resolveThread',
            }
          )
    );
  }

  return actions;
};

/** The message search page for `term` across every room, with its filters and every result. */
export const getCommandPaletteSearchPagePath = (term: string): string =>
  buildPathWithSearch(getHomeSearchPath(), { term: term.trim(), global: 'true' });

export const commandPaletteStaticActionPaths = {
  goHome: getHomePath(),
  goDirect: getDirectPath(),
  goActivity: getActivityPath(),
} as const;
