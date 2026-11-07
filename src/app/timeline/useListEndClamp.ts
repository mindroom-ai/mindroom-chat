import { type RefObject, useEffect } from 'react';

/**
 * How far the list still reaches below its newest row: the height of rows that shrank since React
 * last rendered the list, which its next render takes off the scroll content. The rendered end of
 * the list tells: its newest mounted row with a height ends what the reader sees. Mounted rows
 * after it (hidden events) take none and keep their old places until that render; rows after it
 * that the list does not mount still hold the room that render gave them, their size in `rows`
 * (virtual-core's rows, one per index). The offset ledger places the rows its margin moves the list
 * away from, so the list ends that margin past its newest row, and rows it moves keep their places.
 * The part of the margin that rows folded above the reader brought with their own height
 * (`rowFoldPx`, the ledger's) moved the list's end with them: it is no room the list will give up.
 * Counted, a page of older replies above a reader at the newest one read as that page's height of
 * shrink, and the end clamp threw the reader to the top; so did a page of newer threads above a
 * reader near the end of a newest-first Threads view.
 */
export const listShrinkNotRendered = (
  inner: HTMLElement | null,
  rows: readonly { index: number; size: number }[],
  rowFoldPx = 0
): number => {
  // Test renderers hand over stand-in nodes without the DOM's queries.
  if (typeof inner?.querySelectorAll !== 'function') return 0;
  const tiles = Array.from(inner.querySelectorAll<HTMLElement>(':scope > [data-index]'));
  const indexOf = (tile: HTMLElement) => Number(tile.dataset.index);
  const newest = tiles
    .filter((tile) => tile.offsetHeight > 0)
    .reduce<HTMLElement | undefined>(
      (found, tile) => (!found || indexOf(tile) > indexOf(found) ? tile : found),
      undefined
    );
  if (!newest) return 0;
  const mounted = new Set(tiles.map(indexOf));
  const unmountedAfter = rows
    .slice(indexOf(newest) + 1)
    .reduce((room, row) => (mounted.has(row.index) ? room : room + row.size), 0);
  const ledgerMargin = (parseFloat(inner.style.marginTop) || 0) + rowFoldPx;
  const reach = inner.getBoundingClientRect().bottom - newest.getBoundingClientRect().bottom;
  const result = Math.max(0, reach - ledgerMargin - unmountedAfter);
  if (result > 0)
    ((globalThis as unknown as { __seLog?: unknown[] }).__seLog?.push({ t: performance.now(), ...({ k: 'shrink', result, reach, mt: inner.style.marginTop, rowFoldPx, unmountedAfter, newest: indexOf(newest), rows: tiles.map((tile) => `${tile.dataset.index}:${tile.offsetHeight}`).join(' ') }) }));
  return result;
};

/**
 * Keeps the scroll position from ending past where the list will end. Rows that shrank are still
 * counted in the list's rendered height until React renders it (`pendingListShrinkPx`), so in a
 * frame where the composer's inset shrinks or the content grows, the browser's own clamp and a
 * follow to the end can stop below the newest row and paint a blank band above the composer.
 * This observer of the content and of the footer probe is created after the timeline's other
 * observers, so it runs after them in each pass of the browser's ResizeObserver loop, and clamps
 * the position to that end before the paint.
 */
export function useListEndClamp(
  scroll: HTMLElement | null,
  contentRef: RefObject<HTMLElement>,
  probeRef: RefObject<HTMLElement>,
  pendingListShrinkPx: () => number
): void {
  useEffect(() => {
    const content = contentRef.current;
    const probe = probeRef.current;
    if (!scroll || !content || !probe || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const end = scroll.scrollHeight - scroll.clientHeight - pendingListShrinkPx();
      ((globalThis as unknown as { __seLog?: unknown[] }).__seLog?.push({ t: performance.now(), ...({ k: 'endClamp', end, top: scroll.scrollTop, sh: scroll.scrollHeight, pending: pendingListShrinkPx() }) }));
      if (scroll.scrollTop > end) scroll.scrollTop = Math.max(0, end);
    });
    observer.observe(content);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [contentRef, pendingListShrinkPx, probeRef, scroll]);
}
