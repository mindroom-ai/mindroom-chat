// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  listShrinkAfterResize,
  listShrinkNotRendered,
  pastEndCorrection,
} from './timelineListShrink';

// A thread's newest reply finished and shrank by 62 px; the list keeps its rendered height until
// React renders it again. Rows after the reply (hidden events, edits) take no height.

const box = (element: HTMLElement, top: number, height: number) => {
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: height });
  element.getBoundingClientRect = () =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 0 }) as DOMRect;
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

  it('reads unmounted rows through virtual-core lazy measurements proxies without a has trap', () => {
    const sizes = [68, 3626, 246, 300, 400];
    const cache = new Array<{ index: number; size: number } | undefined>(sizes.length);
    const lazyRows = new Proxy(cache, {
      get(target, prop, receiver) {
        if (typeof prop === 'string') {
          const index = Number(prop);
          if (Number.isInteger(index) && index >= 0 && index < sizes.length) {
            const existing = target[index];
            if (existing) return existing;
            const created = { index, size: sizes[index] ?? 0 };
            target[index] = created;
            return created;
          }
          if (prop === 'length') return sizes.length;
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as readonly { index: number; size: number }[];
    const inner = list(1322, [{ index: 2, top: 376, height: 246 }]);
    expect(listShrinkNotRendered(inner, lazyRows)).toBe(0);
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
    expect(listShrinkAfterResize(shrunk(), rows([68, 3626, 308, 0]), 2, -62)).toBe(62);
    expect(listShrinkAfterResize(shrunk(), rows([68, 3626, 308, 30]), 3, -30)).toBe(62);
  });

  it('adds the shrink of a row after the newest one that is not mounted', () => {
    // The list also holds the 40 px of index 4, which it does not mount.
    expect(listShrinkAfterResize(shrunk(724), rows([68, 3626, 308, 0, 40]), 4, -40)).toBe(102);
  });

  it('counts the newest row at the whole pixels virtual-core measures it in', () => {
    // On screen the reply is 245.5 px tall; virtual-core takes 246 px for it.
    const inner = list(684, [{ index: 2, top: 376, height: 245.5 }]);
    expect(listShrinkAfterResize(inner, rows([68, 3626, 308]), 2, -62)).toBe(62);
  });

  it('cannot tell for a row above the newest one, whose rows below have not moved yet', () => {
    expect(listShrinkAfterResize(shrunk(), rows([68, 3626, 308, 0]), 1, -30)).toBeUndefined();
  });
});

describe('pastEndCorrection', () => {
  const scroller = { scrollHeight: 5840, clientHeight: 600 };

  it('bounds the shownPx === undefined fallback to the overshoot past the new max scroll', () => {
    // At bottom (maxScroll = 5240): corrects by the full delta (-600).
    expect(pastEndCorrection(-600, 5240, 5240, scroller, undefined, 0)).toBe(-600);
    // Away from bottom (440 px above maxScroll): clamps only by the 160 px overshoot, not -600.
    expect(pastEndCorrection(-600, 4800, 4800, scroller, undefined, 0)).toBe(-160);
    // At or above the new maxScroll (4640): leaves scrollTop unchanged.
    expect(pastEndCorrection(-600, 4640, 4640, scroller, undefined, 0)).toBe(0);
    expect(pastEndCorrection(-600, 4000, 4000, scroller, undefined, 0)).toBe(0);
    // Non-negative delta or missing scroll element returns 0.
    expect(pastEndCorrection(0, 5240, 5240, scroller, undefined, 0)).toBe(0);
    expect(pastEndCorrection(20, 5240, 5240, scroller, undefined, 0)).toBe(0);
    expect(pastEndCorrection(-600, 5240, 5240, null, undefined, 0)).toBe(0);
  });

  it('clamps by exact remaining shrink when shownPx is known', () => {
    const shortScroller = { scrollHeight: 1000, clientHeight: 500 };
    expect(pastEndCorrection(-35, 500, 500, shortScroller, 35, 0)).toBe(-35);
    expect(pastEndCorrection(-35, 490, 490, shortScroller, 35, 0)).toBe(-25);
    expect(pastEndCorrection(-35, 400, 400, shortScroller, 35, 0)).toBe(0);
  });
});
