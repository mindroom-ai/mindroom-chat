import { atom } from 'jotai';
import { phoneNavDrawerOpenAtom } from './phoneNavDrawer';

/**
 * Whether a client plugin's cover hides the open room's conversation (room/ConversationCover.tsx):
 * a file dropped on it is not attached.
 */
export const conversationCoveredAtom = atom(false);

/**
 * Whether a side panel takes the open room's conversation's place (room/Room.tsx): it fills the
 * room, or covers the conversation on a phone. The conversation stays under it as it was.
 */
export const conversationBehindPanelAtom = atom(false);

/**
 * Whether the open room's conversation is hidden, under a plugin's cover or behind a side panel:
 * the composer takes no keys and sends no typing notice, and its own popovers close.
 */
export const conversationHiddenAtom = atom(
  (get) => get(conversationCoveredAtom) || get(conversationBehindPanelAtom)
);

/**
 * Whether the open room's conversation is out of sight: a phone's navigation drawer covers the
 * page, or the conversation is hidden. Read receipts wait meanwhile, and notifications count no
 * room as on screen.
 */
export const conversationOutOfSightAtom = atom(
  (get) => get(phoneNavDrawerOpenAtom) || get(conversationHiddenAtom)
);
