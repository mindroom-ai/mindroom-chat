import { useCallback, useEffect, useRef, type RefObject } from 'react';
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
} from '../threads/overview/compactCardKeys';

type UseThreadKeysOptions = {
  roomId: string;
  /** The room's own area, which holds its Compact cards. */
  areaRef: RefObject<HTMLElement>;
  openThreadId: string | undefined;
  viewMode: RoomViewMode;
  onOpenThread: (threadId: string) => void;
  onExitThread: () => void;
  onFocusComposer: () => void;
  /** Moves the focus into the open thread, beside the cards. */
  onFocusThread: () => void;
};

/**
 * The keys that go into a thread and out of it. Alt and the right arrow goes one level in: from
 * the room to its Compact cards (the card of the thread just left, or the first in view), and
 * from the focused card into its thread. Alt and the left arrow goes one level out: from the open
 * thread to its card, and from a focused card to the composer. Where no cards show, Alt and the
 * right arrow opens the thread just left again. ⌘ (Ctrl elsewhere), Alt and the up or down arrow
 * moves the focus through the cards, from outside them to the card beside the open thread's or
 * that of the thread just left. None acts on what a side panel, a plugin's cover or a thread that
 * fills the page hides.
 *
 * Returns how the page gives away the focus a closed thread left: `otherwise` runs unless the
 * card of a thread these keys left takes it, at once or after the pass that card shows in.
 */
export const useThreadKeys = ({
  roomId,
  areaRef,
  openThreadId,
  viewMode,
  onOpenThread,
  onExitThread,
  onFocusComposer,
  onFocusThread,
}: UseThreadKeysOptions): ((otherwise: () => void) => void) => {
  const store = useStore();
  // The cards under a thread that fills the page are gone; a cover or a panel hides the rest.
  const cards = () => (store.get(conversationHiddenAtom) ? [] : compactCardsIn(areaRef.current));
  const threadHidden = () => store.get(conversationBehindPanelAtom);
  const leftThreadId = () => {
    const left = store.get(lastExitedThreadAtom);
    return left?.roomId === roomId ? left.threadId : undefined;
  };

  const step = (direction: -1 | 1): boolean => {
    const shown = cards();
    const focused = focusedCompactCard(areaRef.current);
    if (focused && shown.includes(focused)) {
      focusCompactCard(shown[shown.indexOf(focused) + direction]);
      return true;
    }
    // From outside the cards: beside the open thread's card, or that of the thread just left.
    return focusCompactCard(cardBeside(shown, openThreadId ?? leftThreadId(), direction));
  };
  useShortcut('previousThread', () => step(-1));
  useShortcut('nextThread', () => step(1));

  useShortcut('openThread', () => {
    const shown = cards();
    const focused = focusedCompactCard(areaRef.current);
    if (focused && shown.includes(focused)) {
      // The open thread's own card, beside it: in is the thread, which a click would not focus.
      if (focused.dataset.threadRootId === openThreadId) onFocusThread();
      else focused.click();
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
  // which a step back in the browser's history does a moment after the key. Not from a control
  // the reader went to meanwhile: the focus moves only from where it was at the key, or from the
  // page, where the closed thread left it.
  const leftByKey = useRef<{ threadId: string; focused: Element | null }>();
  const awaitedCard = useRef<{ otherwise?: () => void }>();
  const shownThreadId = useRef(openThreadId);
  useEffect(() => {
    const closed = shownThreadId.current;
    shownThreadId.current = openThreadId;
    if (openThreadId === closed) return;
    const left = leftByKey.current;
    leftByKey.current = undefined;
    if (openThreadId || !left || left.threadId !== closed) return;
    const doc = areaRef.current?.ownerDocument;
    if (!doc) return;
    const unclaimed = () =>
      !doc.activeElement || doc.activeElement === doc.body || doc.activeElement === left.focused;
    const focusCard = () =>
      focusCompactCard(cards().find((card) => card.dataset.threadRootId === left.threadId));
    if (!unclaimed() || focusCard()) return;
    // A Compact list that takes the place of a thread that filled the page shows its cards a
    // pass after this effect, in the same task (`RoomTimeline`). The focus goes once, then: to
    // the card, or as the page gives it (`unlessCardTakesFocus`), and not from a control that
    // took it meanwhile.
    const wait: { otherwise?: () => void } = {};
    awaitedCard.current = wait;
    queueMicrotask(() => {
      if (awaitedCard.current === wait) awaitedCard.current = undefined;
      if (!(unclaimed() && focusCard())) wait.otherwise?.();
    });
  });

  useShortcut('leaveThread', () => {
    if (openThreadId) {
      if (threadHidden()) return false;
      leftByKey.current = {
        threadId: openThreadId,
        focused: areaRef.current?.ownerDocument.activeElement ?? null,
      };
      onExitThread();
      return true;
    }
    const focused = focusedCompactCard(areaRef.current);
    if (!focused || !cards().includes(focused)) return false;
    onFocusComposer();
    // A room without a composer has nowhere out: the keys stay the browser's.
    return focusedCompactCard(areaRef.current) !== focused;
  });

  return useCallback((otherwise) => {
    if (awaitedCard.current) awaitedCard.current.otherwise = otherwise;
    else otherwise();
  }, []);
};
