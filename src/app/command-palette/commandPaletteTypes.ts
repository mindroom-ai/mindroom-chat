/** The palette's tabs, in the order of the tab row. */
export const COMMAND_PALETTE_TABS = ['all', 'rooms', 'threads', 'users', 'messages', 'actions'] as const;

export type CommandPaletteTab = typeof COMMAND_PALETTE_TABS[number];

export type CommandPaletteSectionId = 'actions' | 'threads' | 'rooms' | 'users' | 'messages';

type CommandPaletteBaseItem = {
  id: string;
  boost?: number;
  sortRank?: number;
};

export type CommandPaletteActionItem = CommandPaletteBaseItem & {
  kind: 'action';
  title: string;
  description?: string;
  keywords?: string[];
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
