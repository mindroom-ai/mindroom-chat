import {
  getDirectCreatePath,
  getDirectPath,
  getHomePath,
  getHomeSearchPath,
  getInboxPath,
  getSpaceSearchPath,
} from '../../pages/pathUtils';
import type {
  CommandPaletteActionItem,
  CommandPaletteMessageItem,
} from './commandPaletteTypes';

export type CommandPaletteQuickActionId =
  | 'open-settings'
  | 'go-home'
  | 'go-direct'
  | 'go-inbox'
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
};

export type CommandPaletteUserTarget =
  | {
      kind: 'room';
      roomId: string;
    }
  | {
      kind: 'path';
      path: string;
    };

export type CommandPaletteMessageTarget = CommandPaletteMessageItem & {
  path: string;
};

const buildPathWithSearch = (path: string, searchParams: Record<string, string | undefined>): string => {
  const params = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    if (typeof value === 'string' && value.length > 0) {
      params.set(key, value);
    }
  });

  const search = params.toString();
  return search.length > 0 ? `${path}?${search}` : path;
};

const quoteQuery = (query: string): string => `"${query}"`;

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

export const getCommandPaletteQuickActions = ({
  currentRoomName,
  currentThreadId,
  isCurrentThreadResolved,
}: CommandPaletteQuickActionContext): CommandPaletteActionItem[] => {
  const roomLabel = currentRoomName ?? 'current room';
  const actions: CommandPaletteActionItem[] = [
    actionItem('open-settings', 'Open Settings', 130, {
      description: 'Open the shared settings modal',
      keywords: ['preferences'],
    }),
    actionItem('go-home', 'Go Home', 120, {
      description: 'Jump to Home',
      keywords: ['rooms'],
    }),
    actionItem('go-direct', 'Go Direct Messages', 110, {
      description: 'Jump to Direct Messages',
      keywords: ['dm', 'messages'],
    }),
    actionItem('go-inbox', 'Go Inbox', 100, {
      description: 'Open Inbox notifications',
      keywords: ['notifications'],
    }),
    actionItem('create-room', 'Create Room', 90, {
      description: 'Open the room creation modal',
      keywords: ['new room'],
    }),
    actionItem('create-space', 'Create Space', 80, {
      description: 'Open the space creation modal',
      keywords: ['new space'],
    }),
    actionItem('toggle-theme', 'Toggle Theme', 20, {
      description: 'Switch between light and dark',
      keywords: ['appearance'],
    }),
    actionItem('logout', 'Logout', 10, {
      description: 'Sign out of Cinny',
      keywords: ['sign out'],
    }),
  ];

  if (currentRoomName) {
    actions.splice(
      6,
      0,
      actionItem('mark-current-room-read', 'Mark Current Room Read', 70, {
        description: `Mark ${roomLabel} as read`,
        keywords: ['read', 'unread'],
      }),
      actionItem('copy-current-room-link', 'Copy Current Room Link', 60, {
        description: `Copy an app link for ${roomLabel}`,
        keywords: ['share', 'link'],
      }),
      actionItem('open-current-room-settings', 'Open Current Room Settings', 50, {
        description: `Open settings for ${roomLabel}`,
        keywords: ['room settings'],
      })
    );
  }

  if (currentThreadId) {
    actions.splice(
      actions.findIndex((item) => item.id === 'toggle-theme'),
      0,
      isCurrentThreadResolved
        ? actionItem('unresolve-current-thread', 'Unresolve Current Thread', 40, {
            description: 'Move the active thread back into the unresolved queue',
            keywords: ['thread', 'reopen'],
          })
        : actionItem('resolve-current-thread', 'Resolve Current Thread', 40, {
            description: 'Mark the active thread resolved',
            keywords: ['thread', 'done'],
          })
    );
  }

  return actions;
};

export type CommandPaletteMessageContext = {
  query: string;
  currentRoomId?: string;
  currentRoomName?: string;
  currentSpaceId?: string;
  currentSpaceName?: string;
};

export const getCommandPaletteMessageTargets = ({
  query,
  currentRoomId,
  currentRoomName,
  currentSpaceId,
  currentSpaceName,
}: CommandPaletteMessageContext): CommandPaletteMessageTarget[] => {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) return [];

  const items: CommandPaletteMessageTarget[] = [];
  const quotedQuery = quoteQuery(trimmedQuery);

  if (currentRoomId) {
    items.push({
      id: `message-room-${currentRoomId}-${trimmedQuery}`,
      kind: 'message',
      title: `Search ${quotedQuery} in ${currentRoomName ?? 'current room'}`,
      description: currentRoomName ?? 'Current room',
      scope: 'room',
      path: buildPathWithSearch(
        currentSpaceId ? getSpaceSearchPath(currentSpaceId) : getHomeSearchPath(),
        {
          term: trimmedQuery,
          rooms: currentRoomId,
        }
      ),
    });
  }

  if (currentSpaceId) {
    items.push({
      id: `message-space-${currentSpaceId}-${trimmedQuery}`,
      kind: 'message',
      title: `Search ${quotedQuery} in ${currentSpaceName ?? 'current space'}`,
      description: currentSpaceName ?? 'Current space',
      scope: 'space',
      path: buildPathWithSearch(getSpaceSearchPath(currentSpaceId), {
        term: trimmedQuery,
      }),
    });
  }

  items.push({
    id: `message-all-${trimmedQuery}`,
    kind: 'message',
    title: `Search ${quotedQuery} across all rooms`,
    description: 'Global message search',
    scope: 'all',
    path: buildPathWithSearch(getHomeSearchPath(), {
      term: trimmedQuery,
      global: 'true',
    }),
  });

  return items;
};

export const resolveCommandPaletteUserTarget = (
  userId: string,
  existingDmRoomId?: string
): CommandPaletteUserTarget => {
  if (existingDmRoomId) {
    return {
      kind: 'room',
      roomId: existingDmRoomId,
    };
  }

  return {
    kind: 'path',
    path: buildPathWithSearch(getDirectCreatePath(), {
      userId,
    }),
  };
};

export const commandPaletteStaticActionPaths = {
  goHome: getHomePath(),
  goDirect: getDirectPath(),
  goInbox: getInboxPath(),
} as const;
