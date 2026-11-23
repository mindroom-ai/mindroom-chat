import { describe, expect, it, vi } from 'vitest';
import {
  NOOP_THREAD_SCROLL_TO_FN,
  writeThreadScrollBy,
  writeThreadScrollToBottom,
  writeThreadScrollToIndex,
  writeThreadScrollTop,
  type ThreadScrollVirtualizer,
} from './threadScrollWriter';

const makeFakeScroller = ({ scrollTop = 0, scrollHeight = 2000, clientHeight = 500 } = {}) => {
  let top = scrollTop;
  const scrollTo = vi.fn(({ top: nextTop }: { top: number }) => {
    top = Math.max(0, Math.min(nextTop, Math.max(0, scrollHeight - clientHeight)));
  });
  const scrollBy = vi.fn(({ top: delta }: { top: number }) => {
    top = Math.max(0, Math.min(top + delta, Math.max(0, scrollHeight - clientHeight)));
  });
  const el = {
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.max(0, Math.min(value, Math.max(0, scrollHeight - clientHeight)));
    },
    get scrollHeight() {
      return scrollHeight;
    },
    get clientHeight() {
      return clientHeight;
    },
    scrollTo,
    scrollBy,
  } as unknown as HTMLElement;
  return { el, scrollTo, scrollBy };
};

describe('threadScrollWriter', () => {
  it('clamps target, writes scrollTop, and reconciles virtualizer.scrollOffset to DOM result', () => {
    const { el } = makeFakeScroller({ scrollTop: 100, scrollHeight: 1000, clientHeight: 400 });
    const virtualizer: ThreadScrollVirtualizer = { scrollOffset: 100 };

    const result = writeThreadScrollTop(el, 900, virtualizer);
    expect(result).toEqual({ actual: 600, moved: true, offsetChanged: true });
    expect(el.scrollTop).toBe(600);
    expect(virtualizer.scrollOffset).toBe(600);
  });

  it('skips DOM write when target is within 0.5 px but still reconciles stale virtualizer offset', () => {
    const { el } = makeFakeScroller({ scrollTop: 250, scrollHeight: 1000, clientHeight: 400 });
    const setSpy = vi.spyOn(el, 'scrollTop', 'set');
    const virtualizer: ThreadScrollVirtualizer = { scrollOffset: 100 };

    const result = writeThreadScrollTop(el, 250.3, virtualizer);
    expect(setSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ actual: 250, moved: false, offsetChanged: true });
    expect(virtualizer.scrollOffset).toBe(250);
  });

  it('writes instant and smooth bottom pins through the funnel', () => {
    const { el, scrollTo } = makeFakeScroller({
      scrollTop: 0,
      scrollHeight: 1500,
      clientHeight: 500,
    });
    const virtualizer: ThreadScrollVirtualizer = { scrollOffset: 0 };

    expect(writeThreadScrollToBottom(el, virtualizer, 'instant')).toEqual({
      actual: 1000,
      moved: true,
      offsetChanged: true,
    });
    expect(virtualizer.scrollOffset).toBe(1000);

    el.scrollTop = 100;
    writeThreadScrollToBottom(el, virtualizer, 'smooth');
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });

  it('writes relative deltas and index jumps without calling virtualizer.scrollToIndex', () => {
    const { el, scrollBy } = makeFakeScroller({
      scrollTop: 300,
      scrollHeight: 2000,
      clientHeight: 500,
    });
    const virtualizer: ThreadScrollVirtualizer = {
      scrollOffset: 300,
      getOffsetForIndex: vi.fn(() => [720, 'center'] as [number, 'start' | 'center' | 'end']),
    };

    expect(writeThreadScrollBy(el, -120, virtualizer)).toEqual({
      actual: 180,
      moved: true,
      offsetChanged: true,
    });
    writeThreadScrollBy(el, 40, virtualizer, 'smooth');
    expect(scrollBy).toHaveBeenCalledWith({ top: 40, behavior: 'smooth' });

    expect(writeThreadScrollToIndex(el, virtualizer, 5, 'center')).toEqual({
      actual: 720,
      moved: true,
      offsetChanged: true,
    });
    expect(el.scrollTop).toBe(720);
    expect(virtualizer.scrollOffset).toBe(720);
    expect(NOOP_THREAD_SCROLL_TO_FN()).toBeUndefined();
  });
});
