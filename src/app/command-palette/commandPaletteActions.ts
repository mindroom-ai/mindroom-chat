import { type TFunction } from 'i18next';
import {
  getDirectPath,
  getHomePath,
  getHomeSearchPath,
  getActivityPath,
} from '../routes/pathUtils';
import type { CommandPaletteActionItem } from './commandPaletteTypes';

export type CommandPaletteQuickActionId =
  | 'open-settings'
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
  options?: Pick<CommandPaletteActionItem, 'description' | 'keywords'>
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
  const actions: CommandPaletteActionItem[] = [
    actionItem('open-settings', t('commandPalette.actions.openSettings'), 130, {
      description: t('commandPalette.actions.openSettingsDescription'),
      keywords: ['preferences'],
    }),
    actionItem('go-home', t('commandPalette.actions.goHome'), 120, {
      description: t('commandPalette.actions.goHomeDescription'),
      keywords: ['rooms'],
    }),
    actionItem('go-direct', t('commandPalette.actions.goDirect'), 110, {
      description: t('commandPalette.actions.goDirectDescription'),
      keywords: ['dm', 'messages'],
    }),
    actionItem('go-activity', t('commandPalette.actions.goActivity'), 100, {
      description: t('commandPalette.actions.goActivityDescription'),
      keywords: ['inbox', 'invites', 'notifications', 'mentions'],
    }),
    actionItem('create-room', t('commandPalette.actions.createRoom'), 90, {
      description: t('commandPalette.actions.createRoomDescription'),
      keywords: ['new room'],
    }),
    actionItem('create-space', t('commandPalette.actions.createSpace'), 80, {
      description: t('commandPalette.actions.createSpaceDescription'),
      keywords: ['new space'],
    }),
    actionItem('toggle-theme', t('commandPalette.actions.toggleTheme'), 20, {
      description: t('commandPalette.actions.toggleThemeDescription'),
      keywords: ['appearance'],
    }),
    actionItem('logout', t('commandPalette.actions.logout'), 10, {
      description: t('commandPalette.actions.logoutDescription'),
      keywords: ['sign out'],
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
      }),
      actionItem('copy-current-room-link', t('commandPalette.actions.copyCurrentRoomLink'), 60, {
        description: t('commandPalette.actions.copyCurrentRoomLinkDescription', {
          room: roomLabel,
        }),
        keywords: ['share', 'link'],
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
        }
      )
    );
  }

  if (currentThreadId && !isCurrentThreadPinned) {
    actions.splice(
      actions.findIndex((item) => item.id === 'toggle-theme'),
      0,
      isCurrentThreadResolved
        ? actionItem(
            'unresolve-current-thread',
            t('commandPalette.actions.unresolveCurrentThread'),
            40,
            {
              description: t('commandPalette.actions.unresolveCurrentThreadDescription'),
              keywords: ['thread', 'reopen'],
            }
          )
        : actionItem(
            'resolve-current-thread',
            t('commandPalette.actions.resolveCurrentThread'),
            40,
            {
              description: t('commandPalette.actions.resolveCurrentThreadDescription'),
              keywords: ['thread', 'done'],
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
