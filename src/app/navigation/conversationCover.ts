import { atom } from 'jotai';
import { phoneNavDrawerOpenAtom } from './phoneNavDrawer';

/**
 * Whether a client plugin's cover hides the open room's conversation (room/ConversationCover.tsx):
 * typing notices and file drops wait while it does.
 */
export const conversationCoveredAtom = atom(false);

/**
 * Whether the open room's conversation is out of sight: a phone's navigation drawer covers the
 * page, or a plugin's cover the conversation. Read receipts wait meanwhile, and notifications count
 * no room as on screen.
 */
export const conversationOutOfSightAtom = atom(
  (get) => get(phoneNavDrawerOpenAtom) || get(conversationCoveredAtom)
);
