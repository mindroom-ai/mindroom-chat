// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { listShrinkAfterResize, listShrinkNotRendered } from './useListEndClamp';

// A thread's newest reply finished and shrank by 62 px; the list keeps its rendered height until
// React renders it again. Rows after the reply (hidden events, edits) take no height.

const box = (element: HTMLElement, top: number, height: number) => {
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: height });
  element.getBoundingClientRect = () =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 0 } as DOMRect);
};

/** The list, its bottom at `listBottom`, with the tiles virtual-core mounts. */
const list = (listBottom: number, tiles: { index: number; top: number; height: number }[]) => {
  const inner = document.createElement('div');
  box(inner, listBottom - 4166, 4166);
  tiles.forEach(({ index, top, height }) => {
    const tile = document.createElement('div');
    tile.dataset.index = String(index);
    box(tile, top, height);
    inner.append(tile);
  });
  return inner;
};

const rows = (sizes: number[]) => sizes.map((size, index) => ({ index, size }));

describe('listShrinkNotRendered', () => {
  it('counts a reply that shrank when the rows after it are not mounted', () => {
    // The reply (index 2) ends at 622; its old 308 px still reach to 684.
    const inner = list(684, [
      { index: 0, top: -3482, height: 68 },
      { index: 1, top: -3414, height: 3626 },
      { index: 2, top: 376, height: 246 },
    ]);
    expect(listShrinkNotRendered(inner, rows([68, 3626, 308, 0, 0, 0]))).toBe(62);
  });

  it('leaves out the room unmounted rows after the newest one still hold', () => {
    const inner = list(714, [
      { index: 0, top: -3452, height: 68 },
      { index: 1, top: -3384, height: 3626 },
      { index: 2, top: 376, height: 246 },
    ]);
    expect(listShrinkNotRendered(inner, rows([68, 3626, 308, 30, 0]))).toBe(62);
  });

  it('counts a reply that shrank above mounted rows without a height', () => {
    const inner = list(684, [
      { index: 1, top: -3414, height: 3626 },
      { index: 2, top: 376, height: 246 },
      { index: 3, top: 684, height: 0 },
    ]);
    expect(listShrinkNotRendered(inner, rows([68, 3626, 308, 0]))).toBe(62);
  });

  it('finds nothing pending when the list ends at its newest row', () => {
    const inner = list(622, [{ index: 2, top: 376, height: 246 }]);
    expect(listShrinkNotRendered(inner, rows([68, 3626, 246, 0]))).toBe(0);
  });

  it('finds nothing pending for a page of older rows folded above a reader at the newest one', () => {
    // 100 older replies landed above: the ledger lifts the list by their 9660 px, and the list
    // grew by as much, so it still ends at its newest row.
    const inner = list(622, [{ index: 102, top: 376, height: 246 }]);
    inner.style.marginTop = '-9660px';
    expect(listShrinkNotRendered(inner, rows([...Array<number>(102).fill(96), 246]), 9660)).toBe(0);
  });

  it('counts the part of the margin no rows brought with them', () => {
    // A correction the ledger took for a row above (169.5 px) lifted the list without the list
    // growing: the scroll content lost that much below the reader.
    const inner = list(622, [{ index: 2, top: 376, height: 246 }]);
    inner.style.marginTop = '-169.5px';
    expect(listShrinkNotRendered(inner, rows([68, 3626, 246]), 0)).toBe(169.5);
  });
});

describe('listShrinkAfterResize', () => {
  // The reply (index 2) shrank to 246 px; the list still holds its old 308 px.
  const shrunk = (listBottom = 684) =>
    list(listBottom, [
      { index: 1, top: -3414, height: 3626 },
      { index: 2, top: 376, height: 246 },
      { index: 3, top: 684, height: 0 },
    ]);

  it('reads the shrink the rendered rows show for the newest row and a mounted row after it', () => {
    expect(listShrinkAfterResize(shrunk(), rows([68, 3626, 308, 0]), 0, 2, -62)).toBe(62);
    expect(listShrinkAfterResize(shrunk(), rows([68, 3626, 308, 30]), 0, 3, -30)).toBe(62);
  });

  it('adds the shrink of a row after the newest one that is not mounted', () => {
    // The list also holds the 40 px of index 4, which it does not mount.
    expect(listShrinkAfterResize(shrunk(724), rows([68, 3626, 308, 0, 40]), 0, 4, -40)).toBe(102);
  });

  it('counts the newest row at the whole pixels virtual-core measures it in', () => {
    // On screen the reply is 245.5 px tall; virtual-core takes 246 px for it.
    const inner = list(684, [{ index: 2, top: 376, height: 245.5 }]);
    expect(listShrinkAfterResize(inner, rows([68, 3626, 308]), 0, 2, -62)).toBe(62);
  });

  it('cannot tell for a row above the newest one, whose rows below have not moved yet', () => {
    expect(listShrinkAfterResize(shrunk(), rows([68, 3626, 308, 0]), 0, 1, -30)).toBeUndefined();
  });
});
