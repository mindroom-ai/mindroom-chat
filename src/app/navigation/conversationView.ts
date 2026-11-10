import { createContext, useContext, useMemo } from 'react';
import { atom, useAtomValue, type Atom } from 'jotai';
import { conversationHiddenAtom, conversationOutOfSightAtom } from './conversationCover';
import { phoneNavDrawerOpenAtom } from './phoneNavDrawer';
import type { ViewedPlace } from './viewedPlace';

/**
 * A conversation the page shows besides the room page's own, such as a client plugin's thread view
 * (room/ThreadView.tsx), named by a key of its own. Its composer has a reply and staged files of
 * its own, which go with the view; it is hidden while it does not show, and also out of sight
 * under a phone's navigation drawer. Without one, a timeline and its composer are the room page's.
 */
export const ConversationViewContext = createContext<string | undefined>(undefined);

/** The key of a composer's reply and staged files in `roomId`: the room ID on the room's page. */
export const composerStateKey = (roomId: string, view: string | undefined): string =>
  view === undefined ? roomId : JSON.stringify([roomId, view]);

/** Whether this timeline or composer is in another view than the room page's. */
export const useInConversationView = (): boolean =>
  useContext(ConversationViewContext) !== undefined;

/**
 * Each other view on screen now, with the room and thread it shows: notifications count those as
 * on screen. A view lists itself while it shows (room/ThreadView.tsx).
 */
export const shownConversationViewsAtom = atom<readonly (ViewedPlace & { view: string })[]>([]);

/**
 * Whether this conversation is hidden: the room's page under a plugin's cover or behind a side
 * panel (`conversationHiddenAtom`), another view while it does not show (a folded side panel).
 */
export const useConversationHidden = (): boolean => {
  const view = useContext(ConversationViewContext);
  const pageHidden = useAtomValue(conversationHiddenAtom);
  const shown = useAtomValue(shownConversationViewsAtom);
  return view === undefined ? pageHidden : !shown.some((place) => place.view === view);
};

/**
 * The atom saying whether this conversation is out of sight (`conversationOutOfSightAtom` on the
 * room's page); another view is while it does not show (`shownConversationViewsAtom`) or a phone's
 * navigation drawer covers it.
 */
export const useConversationOutOfSightAtom = (): Atom<boolean> => {
  const view = useContext(ConversationViewContext);
  return useMemo(
    () =>
      view === undefined
        ? conversationOutOfSightAtom
        : atom(
            (get) =>
              get(phoneNavDrawerOpenAtom) ||
              !get(shownConversationViewsAtom).some((shown) => shown.view === view)
          ),
    [view]
  );
};
