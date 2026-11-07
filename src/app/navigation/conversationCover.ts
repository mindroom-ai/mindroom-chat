import { atom } from 'jotai';

/**
 * Whether a client plugin's cover hides the open room's conversation (room/ConversationCover.tsx):
 * read receipts, typing notices and file drops wait while it does.
 */
export const conversationCoveredAtom = atom(false);
