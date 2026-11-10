import { createContext, useContext } from 'react';
import { atom, useAtomValue, type Atom } from 'jotai';
import { conversationHiddenAtom, conversationOutOfSightAtom } from './conversationCover';
import { phoneNavDrawerOpenAtom } from './phoneNavDrawer';
import type { ViewedPlace } from './viewedPlace';

/**
 * A conversation the page shows besides the room page's own, such as a client plugin's thread view
 * (room/ThreadView.tsx), named by a key of its own. Its composer has a reply and staged files of
 * its own, which no reload keeps, and it is hidden only with the whole page. Without one, a
 * timeline and its composer are the room page's.
 */
export const ConversationViewContext = createContext<string | undefined>(undefined);

/** The key of a composer's reply and staged files in `roomId`: the room ID on the room's page. */
export const composerStateKey = (roomId: string, view: string | undefined): string =>
  view === undefined ? roomId : JSON.stringify([roomId, view]);

/** Whether this timeline or composer is in another view than the room page's. */
export const useInConversationView = (): boolean =>
  useContext(ConversationViewContext) !== undefined;

/**
 * Whether this conversation is hidden: the room's page under a plugin's cover or behind a side
 * panel (`conversationHiddenAtom`). Another view is never hidden that way.
 */
export const useConversationHidden = (): boolean => {
  const hidden = useAtomValue(conversationHiddenAtom);
  return !useInConversationView() && hidden;
};

/**
 * The atom saying whether this conversation is out of sight (`conversationOutOfSightAtom` on the
 * room's page); another view is only under a phone's navigation drawer.
 */
export const useConversationOutOfSightAtom = (): Atom<boolean> =>
  useInConversationView() ? phoneNavDrawerOpenAtom : conversationOutOfSightAtom;

/** The room and thread of each other view mounted now, which notifications count as on screen. */
export const shownConversationViewsAtom = atom<readonly ViewedPlace[]>([]);
