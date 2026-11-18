import { type RefObject, useEffect, useLayoutEffect } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { reactionOrEditEvent } from '../matrix/room';
import { useViewScopedState } from './roomTimelineViewScope';
import { openProbe } from '../diagnostics/openProbe';

/** The longest a thread's rows stay hidden while it opens, whatever holds them back. */
export const THREAD_REVEAL_AFTER_MS = 1_500;

type ThreadOpeningRevealOptions = {
  /** The view shown: the room and its open thread. */
  viewKey: string;
  /** Whether the open thread opens at its newest reply (no target event). */
  opensAtLatest: boolean;
  /** The rows of the thread's virtual list. */
  rows: readonly MatrixEvent[];
  scrollRef: RefObject<HTMLElement>;
  /** Whether the reader took the position over: a gesture, a jump, a request for older history. */
  readerTookOver: () => boolean;
};

/**
 * Whether an opening thread keeps its rows hidden. A thread that opens at its newest reply renders
 * the rows the client already holds (the root and the newest replies) before its open pins them
 * to the bottom, and on a long thread they would paint at the top and jump there a moment later.
 * The rows stay hidden until the view first rests at the end of its scroll range with the list's
 * last tile mounted (the virtual list can still hold the rows of the scroll position before the
 * pin), checked after every commit, after the pins; or the reader takes over; or
 * THREAD_REVEAL_AFTER_MS pass. Once shown, they stay shown for the view. The last tile is the last
 * row's that is not an edit or a reaction: those have no tile once they measure to no height
 * (renderTimelineTiles), and a streamed reply leaves its edits at the end of the list.
 */
export const useThreadOpeningReveal = ({
  viewKey,
  opensAtLatest,
  rows,
  scrollRef,
  readerTookOver,
}: ThreadOpeningRevealOptions): boolean => {
  const [revealed, setRevealed] = useViewScopedState(viewKey, () => !opensAtLatest);

  useLayoutEffect(() => {
    if (revealed) return;
    const scrollArea = scrollRef.current;
    const lastTileIndex = rows.findLastIndex((row) => !reactionOrEditEvent(row));
    const atEnd =
      !!scrollArea &&
      lastTileIndex >= 0 &&
      scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop <= 1 &&
      !!scrollArea.querySelector(`[data-index="${lastTileIndex}"]`);
    const mounted = scrollArea ? Array.from(scrollArea.querySelectorAll('[data-index]')) : [];
    const indexes = mounted.map((element) => Number(element.getAttribute('data-index')));
    openProbe('reveal-check', {
      rows: rows.length,
      lastTileIndex,
      gap: scrollArea
        ? Math.round(scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop)
        : null,
      scrollHeight: scrollArea?.scrollHeight ?? null,
      scrollTop: scrollArea ? Math.round(scrollArea.scrollTop) : null,
      hasLastTile: !!scrollArea?.querySelector(`[data-index="${lastTileIndex}"]`),
      mounted: indexes.length,
      minIndex: indexes.length ? Math.min(...indexes) : null,
      maxIndex: indexes.length ? Math.max(...indexes) : null,
      messages: scrollArea?.querySelectorAll('[data-message-id]').length ?? 0,
      took: readerTookOver(),
      atEnd,
    });
    if (atEnd || readerTookOver()) setRevealed(true);
  });

  useEffect(() => {
    if (revealed) return undefined;
    const timer = setTimeout(() => {
      openProbe('reveal-timeout');
      setRevealed(true);
    }, THREAD_REVEAL_AFTER_MS);
    return () => clearTimeout(timer);
  }, [revealed, setRevealed]);

  return !revealed;
};
