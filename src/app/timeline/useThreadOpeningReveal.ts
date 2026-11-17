import { type RefObject, useEffect, useLayoutEffect } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk';
import { reactionOrEditEvent } from '../matrix/room';
import { scrollToBottom } from '../lib/dom';
import { useViewScopedState } from './roomTimelineViewScope';

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
  /**
   * Whether this commit shows the rows at the sizes measured so far: not at sizes a measurement
   * of this commit replaced, and not at a list height held back for the next render.
   */
  rowsAtMeasuredSizes: () => boolean;
};

/** An edit or a reaction has no tile once it measures to no height. */
const isTile = (row: MatrixEvent): boolean => !reactionOrEditEvent(row);

const atEndOf = (scrollArea: HTMLElement): boolean =>
  scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop <= 1;

/**
 * Whether an opening thread keeps its rows hidden. A thread that opens at its newest reply starts
 * its list at its end with the rows near its view, at estimated sizes: measured, they move the
 * end, and painted then they would jump there a moment later. While the rows are hidden, every
 * commit leaves the view at the end of its scroll range, and the rows show once a commit rests
 * there with the list's last tile mounted, at the sizes measured so far, and with rows up to the
 * top of the view, below the sticky header (or the thread's first row): a list measured shorter
 * than estimated leaves the top of the view empty until the rows above mount. Checked after every commit, after the pins.
 * The rows also show when the reader takes over, whose scroll then stands, or after
 * THREAD_REVEAL_AFTER_MS. Once shown, they stay shown for the view. The last tile is the last
 * row's that is not an edit or a reaction: those have no tile once they measure to no height
 * (renderTimelineTiles), and a streamed reply leaves its edits at the end of the list.
 */
export const useThreadOpeningReveal = ({
  viewKey,
  opensAtLatest,
  rows,
  scrollRef,
  readerTookOver,
  rowsAtMeasuredSizes,
}: ThreadOpeningRevealOptions): boolean => {
  const [revealed, setRevealed] = useViewScopedState(viewKey, () => !opensAtLatest);

  useLayoutEffect(() => {
    if (revealed) return;
    if (readerTookOver()) {
      setRevealed(true);
      return;
    }
    const scrollArea = scrollRef.current;
    if (!scrollArea) return;
    if (!atEndOf(scrollArea)) scrollToBottom(scrollArea);
    const lastTileIndex = rows.findLastIndex(isTile);
    const firstTile = scrollArea.querySelector('[data-index]');
    // The reader's view starts below the sticky header (scroll-padding-top).
    const viewTop =
      scrollArea.getBoundingClientRect().top +
      (Number.parseFloat(getComputedStyle(scrollArea).scrollPaddingTop) || 0);
    const filled =
      !!firstTile &&
      (Number(firstTile.getAttribute('data-index')) <= rows.findIndex(isTile) ||
        firstTile.getBoundingClientRect().top <= viewTop + 1);
    if (
      lastTileIndex >= 0 &&
      atEndOf(scrollArea) &&
      !!scrollArea.querySelector(`[data-index="${lastTileIndex}"]`) &&
      filled &&
      rowsAtMeasuredSizes()
    ) {
      setRevealed(true);
    }
  });

  useEffect(() => {
    if (revealed) return undefined;
    const timer = setTimeout(() => setRevealed(true), THREAD_REVEAL_AFTER_MS);
    return () => clearTimeout(timer);
  }, [revealed, setRevealed]);

  return !revealed;
};
