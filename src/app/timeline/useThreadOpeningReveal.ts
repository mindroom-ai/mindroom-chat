import { type RefObject, useEffect, useLayoutEffect } from 'react';
import { useViewScopedState } from './roomTimelineViewScope';

/** The longest a thread's rows stay hidden while it opens, whatever holds them back. */
export const THREAD_REVEAL_AFTER_MS = 1_500;

type ThreadOpeningRevealOptions = {
  /** The view shown: the room and its open thread. */
  viewKey: string;
  /** Whether the open thread opens at its newest reply (no target event). */
  opensAtLatest: boolean;
  /** How many rows the thread's virtual list holds. */
  rowCount: number;
  scrollRef: RefObject<HTMLElement>;
  /** Whether the reader took the position over: a gesture, a jump, a request for older history. */
  readerTookOver: () => boolean;
};

/**
 * Whether an opening thread keeps its rows hidden. A thread that opens at its newest reply renders
 * the rows the client already holds (the root and the newest replies) before its open pins them
 * to the bottom, and on a long thread they would paint at the top and jump there a moment later.
 * The rows stay hidden until the view first rests at the end of its scroll range with the list's
 * last row mounted (the virtual list can still hold the rows of the scroll position before the
 * pin), checked after every commit, after the pins; or the reader takes over; or
 * THREAD_REVEAL_AFTER_MS pass. Once shown, they stay shown for the view.
 */
export const useThreadOpeningReveal = ({
  viewKey,
  opensAtLatest,
  rowCount,
  scrollRef,
  readerTookOver,
}: ThreadOpeningRevealOptions): boolean => {
  const [revealed, setRevealed] = useViewScopedState(viewKey, () => !opensAtLatest);

  useLayoutEffect(() => {
    if (revealed) return;
    const scrollArea = scrollRef.current;
    const atEnd =
      !!scrollArea &&
      rowCount > 0 &&
      scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop <= 1 &&
      !!scrollArea.querySelector(`[data-index="${rowCount - 1}"]`);
    if (atEnd || readerTookOver()) setRevealed(true);
  });

  useEffect(() => {
    if (revealed) return undefined;
    const timer = setTimeout(() => setRevealed(true), THREAD_REVEAL_AFTER_MS);
    return () => clearTimeout(timer);
  }, [revealed, setRevealed]);

  return !revealed;
};
