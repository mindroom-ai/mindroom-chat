import { type RefObject, useEffect } from 'react';

/**
 * How far the list still reaches below its newest row: the height of rows that shrank since React
 * last rendered the list, which its next render takes off the scroll content. Only the rendered end
 * of the list tells: its last row with a height (hidden events after it take none, and keep their
 * old places until that render). The offset ledger places the rows its margin moves the list away
 * from, so the list ends that margin past its newest row, and rows it moves keep their places.
 * `rows` are the list's rows as virtual-core places them, one per index.
 */
export const listShrinkNotRendered = (
  inner: HTMLElement | null,
  rows: readonly { index: number; size: number }[]
): number => {
  if (!inner) return 0;
  const tiles = Array.from(inner.querySelectorAll<HTMLElement>(':scope > [data-index]'));
  const indexOf = (tile: HTMLElement) => Number(tile.dataset.index);
  const last = rows.length - 1;
  if (!tiles.some((tile) => indexOf(tile) === last)) return 0;
  const newest = tiles
    .filter((tile) => tile.offsetHeight > 0)
    .reduce<HTMLElement | undefined>(
      (found, tile) => (!found || indexOf(tile) > indexOf(found) ? tile : found),
      undefined
    );
  if (!newest) return 0;
  const ledgerMargin = parseFloat(inner.style.marginTop) || 0;
  const reach = inner.getBoundingClientRect().bottom - newest.getBoundingClientRect().bottom;
  return Math.max(0, reach - ledgerMargin);
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
      if (scroll.scrollTop > end) scroll.scrollTop = Math.max(0, end);
    });
    observer.observe(content);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [contentRef, pendingListShrinkPx, probeRef, scroll]);
}
