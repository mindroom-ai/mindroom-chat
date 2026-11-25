/**
 * `listShrinkNotRendered` before it drops below 0, with the newest row, the mounted rows, and how
 * much more than its height on screen virtual-core counts for the newest row, which it measures
 * in whole pixels.
 */
const listReach = (inner: HTMLElement | null, rows: readonly { index: number; size: number }[]) => {
  // Test renderers hand over stand-in nodes without the DOM's queries.
  if (typeof inner?.querySelectorAll !== 'function') return undefined;
  const tiles = Array.from(inner.querySelectorAll<HTMLElement>(':scope > [data-index]'));
  const indexOf = (tile: HTMLElement) => Number(tile.dataset.index);
  const newest = tiles
    .filter((tile) => tile.offsetHeight > 0)
    .reduce<HTMLElement | undefined>(
      (found, tile) => (!found || indexOf(tile) > indexOf(found) ? tile : found),
      undefined
    );
  if (!newest) return undefined;
  const mounted = new Set(tiles.map(indexOf));
  // Indexed read, not `.slice()`: virtual-core's lazy measurements proxy has no `has` trap over
  // its sparse backing array, so `.slice()` yields holes and `.reduce()` drops unmounted rows.
  let unmountedAfter = 0;
  for (let i = indexOf(newest) + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row && !mounted.has(row.index)) unmountedAfter += row.size;
  }
  const { bottom, height } = newest.getBoundingClientRect();
  const reach = inner.getBoundingClientRect().bottom - bottom;
  return {
    px: reach - unmountedAfter,
    newest: indexOf(newest),
    mounted,
    roundingPx: Math.round(height) - height,
  };
};

/**
 * How far the list still reaches below its newest row: the height of rows that shrank since React
 * last rendered the list, which its next render takes off the scroll content. The rendered end of
 * the list tells: its newest mounted row with a height ends what the reader sees. Mounted rows
 * after it (hidden events) take none and keep their old places until that render; rows after it
 * that the list does not mount still hold the room that render gave them, their size in `rows`
 * (virtual-core's rows, one per index).
 */
export const listShrinkNotRendered = (
  inner: HTMLElement | null,
  rows: readonly { index: number; size: number }[]
): number => Math.max(0, listReach(inner, rows)?.px ?? 0);

/**
 * `listShrinkNotRendered` as it reads once virtual-core takes a new size for the row at `index`,
 * when the rendered rows already show that size: the row is mounted at or after the newest row
 * with a height, or after it and not mounted, its old size still counted in `rows`. A row above
 * the newest one moves the rows after it only when React renders them: undefined. The newest row
 * counts at the whole pixels virtual-core gives it, so the list's next height matches.
 */
export const listShrinkAfterResize = (
  inner: HTMLElement | null,
  rows: readonly { index: number; size: number }[],
  index: number,
  deltaPx: number
): number | undefined => {
  const reach = listReach(inner, rows);
  if (!reach || index < reach.newest) return undefined;
  const px = reach.px - reach.roundingPx;
  return reach.mounted.has(index) ? px : px - deltaPx;
};

/**
 * Keeps a reader at the list's end pinned when an in-view row shrinks before React renders the
 * shorter list height (preventing a one-frame blank band above the composer on splitter drag).
 */
export const pastEndCorrection = (
  delta: number,
  scrollOffset: number,
  renderedOffset: number,
  scrollElement: { scrollHeight?: number; clientHeight?: number } | null | undefined,
  shownPx: number | undefined,
  rowMovesPx: number
): number => {
  const { scrollHeight, clientHeight } = scrollElement ?? {};
  if (delta >= 0 || scrollHeight === undefined || clientHeight === undefined) return 0;
  if (shownPx === undefined)
    return scrollHeight - clientHeight - renderedOffset < -delta ? delta : 0;
  return Math.min(0, scrollHeight - clientHeight - shownPx + rowMovesPx - scrollOffset);
};
