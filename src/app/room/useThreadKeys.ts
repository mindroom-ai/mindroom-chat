import type { RefObject } from 'react';
import { useStore } from 'jotai';
import {
  conversationBehindPanelAtom,
  conversationHiddenAtom,
} from '../navigation/conversationCover';
import type { RoomViewMode } from '../navigation/roomViewMode';
import { useShortcut } from '../shortcuts/useShortcut';
import { lastExitedThreadAtom } from '../threads/lastExitedThread';
import {
  cardBeside,
  compactCardsIn,
  focusCompactCard,
  focusedCompactCard,
  stepCompactThread,
} from '../threads/overview/compactCardKeys';

type UseThreadKeysOptions = {
  roomId: string;
  /** The room's own area, which holds its Compact cards. */
  areaRef: RefObject<HTMLElement>;
  openThreadId: string | undefined;
  viewMode: RoomViewMode;
  onOpenThread: (threadId: string) => void;
  onExitThread: () => void;
};

/**
 * The keys that go into a thread and out of it. Alt and the left arrow leaves the open thread;
 * Alt and the right arrow opens the focused card, or the thread just left again. ⌘ (Ctrl
 * elsewhere), Alt and the up or down arrow moves the focus through the Compact cards, from
 * outside them to the card beside the thread just left; in an open thread it opens the thread
 * above or below in the order the cards last showed. None acts on what a side panel or a
 * plugin's cover hides.
 */
export const useThreadKeys = ({
  roomId,
  areaRef,
  openThreadId,
  viewMode,
  onOpenThread,
  onExitThread,
}: UseThreadKeysOptions): void => {
  const store = useStore();
  // The cards under a thread that fills the page are gone; a cover or a panel hides the rest.
  const cards = () => (store.get(conversationHiddenAtom) ? [] : compactCardsIn(areaRef.current));
  const threadHidden = () => store.get(conversationBehindPanelAtom);
  const leftThreadId = () => {
    const left = store.get(lastExitedThreadAtom);
    return left?.roomId === roomId ? left.threadId : undefined;
  };

  const step = (direction: -1 | 1, event: KeyboardEvent): boolean => {
    const shown = cards();
    const focused = focusedCompactCard(areaRef.current);
    if (focused && shown.includes(focused)) {
      focusCompactCard(shown[shown.indexOf(focused) + direction]);
      return true;
    }
    if (openThreadId) {
      if (viewMode !== 'compact' || threadHidden()) return false;
      const next = stepCompactThread(roomId, openThreadId, direction);
      if (!next) return false;
      // Held keys walk the cards, but open one thread per press.
      if (!event.repeat) onOpenThread(next);
      return true;
    }
    return focusCompactCard(cardBeside(shown, leftThreadId(), direction));
  };
  useShortcut('previousThread', (event) => step(-1, event));
  useShortcut('nextThread', (event) => step(1, event));

  useShortcut('openThread', () => {
    const focused = focusedCompactCard(areaRef.current);
    if (focused && cards().includes(focused)) {
      focused.click();
      return true;
    }
    const left = leftThreadId();
    if (openThreadId || !left || viewMode === 'classic' || store.get(conversationHiddenAtom)) {
      return false;
    }
    onOpenThread(left);
    return true;
  });

  useShortcut('leaveThread', () => {
    if (!openThreadId || threadHidden()) return false;
    onExitThread();
    return true;
  });
};
