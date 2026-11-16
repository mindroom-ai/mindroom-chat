import type { IconSrc } from 'folds';
import type { ShortcutId } from '../shortcuts/shortcuts';

/** The palette's tabs, in the order of the tab row. */
export const COMMAND_PALETTE_TABS = [
  'all',
  'rooms',
  'threads',
  'users',
  'messages',
  'actions',
] as const;

export type CommandPaletteTab = (typeof COMMAND_PALETTE_TABS)[number];

export type CommandPaletteSectionId = 'actions' | 'threads' | 'rooms' | 'users' | 'messages';

type CommandPaletteBaseItem = {
  id: string;
  boost?: number;
  sortRank?: number;
};

export type CommandPalettePageId = 'theme' | 'message-layout' | 'language';

/**
 * A row together with what choosing it does. `preview` shows what choosing it would do while the
 * row is highlighted in its page, and returns what takes that back.
 */
export type Executable<T> = T & { onSelect?: () => void; preview?: () => () => void };

export type CommandPaletteActionItem = CommandPaletteBaseItem & {
  kind: 'action';
  title: string;
  /** The language of the title, when it is not the app's. */
  lang?: string;
  description?: string;
  keywords?: string[];
  /** Its own icon; without one, the terminal. */
  icon?: IconSrc;
  /** A word after the title that says what kind of row it is. */
  tag?: string;
  /** The keyboard shortcut of the same action, shown at the row's end. */
  shortcut?: ShortcutId;
  /** A row that flips something: what it is now. */
  state?: 'on' | 'off';
  /** A choice of a page: whether it is the one in effect. */
  current?: boolean;
  /** Choosing the row opens this page. */
  page?: CommandPalettePageId;
  /** Choosing the row leaves the palette open, so the row can show its new state. */
  keepOpen?: boolean;
};

export type CommandPalettePage = {
  title: string;
  /** In display order: their sortRank descends. */
  items: readonly Executable<CommandPaletteActionItem>[];
};

export type CommandPaletteRoomItem = CommandPaletteBaseItem & {
  kind: 'room' | 'space';
  name: string;
  canonicalAlias?: string;
  topic?: string;
  parentNames?: string[];
  unreadCount?: number;
  unreadHighlight?: boolean;
};

export type CommandPaletteUserItem = CommandPaletteBaseItem & {
  kind: 'user';
  displayName: string;
  userId: string;
  localpart: string;
  dmRoomName?: string;
  existingDmRoomId?: string;
  /** The avatar's HTTP URL; without one the row shows the name's first letter. */
  avatarUrl?: string;
  /** A Matrix ID typed in full that the server's user directory did not return. */
  typedId?: boolean;
};

/** Asks before a direct chat with a person starts, since that sends them an invite. */
export type CommandPaletteStartChatItem = CommandPaletteBaseItem &
  Pick<CommandPaletteUserItem, 'userId' | 'displayName' | 'avatarUrl'> & {
    kind: 'start-chat';
  };

export type CommandPaletteThreadItem = CommandPaletteBaseItem & {
  kind: 'thread';
  roomId: string;
  threadId: string;
  summaryText: string;
  isFallbackSummary?: boolean;
  roomName: string;
  participantNames?: string[];
  tags?: string[];
  isResolved?: boolean;
  messageCount?: number;
};

/** One message the server found for the typed text. */
export type CommandPaletteMessageItem = CommandPaletteBaseItem & {
  kind: 'message';
  senderName: string;
  roomName: string;
  /** Set for a message in a thread: the thread's title, or empty when it is not known. */
  threadName?: string;
  /** One line of the message around its first match. */
  snippet: string;
  /** The words the server matched, to mark in the snippet. */
  highlights: string[];
  timestamp: number;
};

/** The last row of the messages: opens the full message search page for the typed text. */
export type CommandPaletteSearchPageItem = CommandPaletteBaseItem & {
  kind: 'search-page';
  term: string;
};

export type CommandPaletteItem =
  | CommandPaletteActionItem
  | CommandPaletteRoomItem
  | CommandPaletteUserItem
  | CommandPaletteStartChatItem
  | CommandPaletteThreadItem
  | CommandPaletteMessageItem
  | CommandPaletteSearchPageItem;
