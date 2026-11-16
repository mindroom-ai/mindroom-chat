import { useEffect, useRef, type RefObject } from 'react';
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
  /** With `replace`, the thread takes the open one's place in the browser's history. */
  onOpenThread: (threadId: string, replace?: boolean) => void;
  onExitThread: () => void;
  onFocusComposer: () => void;
};

/**
 * The keys that go into a thread and out of it. Alt and the right arrow goes one level in: from
 * the room to its Compact cards (the card of the thread just left, or the first in view), and
 * from the focused card into its thread. Alt and the left arrow goes one level out: from the open
 * thread to its card, and from a focused card to the composer. Where no cards show, Alt and the
 * right arrow opens the thread just left again. ⌘ (Ctrl elsewhere), Alt and the up or down arrow
 * moves the focus through the cards, from outside them to the card beside the thread just left;
 * in an open thread it opens the thread above or below in the order the cards last showed. None
 * acts on what a side panel or a plugin's cover hides.
 */
export const useThreadKeys = ({
  roomId,
  areaRef,
  openThreadId,
  viewMode,
  onOpenThread,
  onExitThread,
  onFocusComposer,
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
      // Held keys walk the cards, but open one thread per press. The thread takes this one's
      // place in the history, so leaving it still steps back to the room.
      if (!event.repeat) onOpenThread(next, true);
      return true;
    }
    return focusCompactCard(cardBeside(shown, leftThreadId(), direction));
  };
  useShortcut('previousThread', (event) => step(-1, event));
  useShortcut('nextThread', (event) => step(1, event));

  useShortcut('openThread', () => {
    const shown = cards();
    const focused = focusedCompactCard(areaRef.current);
    if (focused && shown.includes(focused)) {
      focused.click();
      return true;
    }
    if (openThreadId) return false;
    const left = leftThreadId();
    if (shown.length > 0) return focusCompactCard(cardBeside(shown, left, 0));
    if (!left || viewMode === 'classic' || store.get(conversationHiddenAtom)) return false;
    onOpenThread(left);
    return true;
  });

  // The thread these keys left: its card takes the focus once the room shows without the thread,
  // which a step back in the browser's history does a moment after the key.
  const leftByKey = useRef<string>();
  const shownThreadId = useRef(openThreadId);
  useEffect(() => {
    const closed = shownThreadId.current;
    shownThreadId.current = openThreadId;
    const wanted = leftByKey.current;
    if (openThreadId === closed) return;
    leftByKey.current = undefined;
    if (openThreadId || !wanted || wanted !== closed || focusedCompactCard(areaRef.current)) return;
    focusCompactCard(cards().find((card) => card.dataset.threadRootId === wanted));
  });

  useShortcut('leaveThread', () => {
    if (openThreadId) {
      if (threadHidden()) return false;
      leftByKey.current = openThreadId;
      onExitThread();
      return true;
    }
    const focused = focusedCompactCard(areaRef.current);
    if (!focused || !cards().includes(focused)) return false;
    onFocusComposer();
    return true;
  });
};
