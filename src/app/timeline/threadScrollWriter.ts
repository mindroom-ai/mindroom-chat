import type { Virtualizer } from '@tanstack/react-virtual';

/**
 * Read-only `scrollToFn` passed to `@tanstack/react-virtual` when the thread
 * scroll owner owns `scrollTop`. The virtualizer never issues DOM scroll writes.
 */
export const NOOP_THREAD_SCROLL_TO_FN = (): void => {};

export type ThreadScrollVirtualizer = Pick<Virtualizer<HTMLDivElement, Element>, 'scrollOffset'> & {
  getOffsetForIndex?: Virtualizer<HTMLDivElement, Element>['getOffsetForIndex'];
};

export type ThreadScrollWriteResult = {
  actual: number;
  moved: boolean;
  offsetChanged: boolean;
};

/**
 * Single DOM scroll writer for the thread scroll owner.
 * Clamps `target` to the scroller's live range, writes `scrollTop` only when the
 * delta exceeds 0.5 px, and reconciles `virtualizer.scrollOffset` immediately to
 * the actual DOM value after native clamping.
 */
export const writeThreadScrollTop = (
  scrollElement: HTMLElement,
  target: number,
  virtualizer?: ThreadScrollVirtualizer
): ThreadScrollWriteResult => {
  const maxTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
  const clamped = Math.max(0, Math.min(target, maxTop));
  const prevTop = scrollElement.scrollTop;
  const moved = Math.abs(prevTop - clamped) > 0.5;
  if (moved) {
    scrollElement.scrollTop = clamped;
  }
  const actual = scrollElement.scrollTop;
  let offsetChanged = false;
  if (virtualizer) {
    offsetChanged = Math.abs((virtualizer.scrollOffset ?? 0) - actual) > 0.5;
    if (offsetChanged) {
      virtualizer.scrollOffset = actual;
    }
  }
  return { actual, moved, offsetChanged };
};

export const writeThreadScrollToBottom = (
  scrollElement: HTMLElement,
  virtualizer?: ThreadScrollVirtualizer,
  behavior: ScrollBehavior = 'instant'
): ThreadScrollWriteResult => {
  const maxTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
  if (behavior === 'smooth') {
    const prevTop = scrollElement.scrollTop;
    const moved = Math.abs(prevTop - maxTop) > 0.5;
    if (moved) {
      scrollElement.scrollTo({ top: maxTop, behavior: 'smooth' });
    }
    const actual = scrollElement.scrollTop;
    return { actual, moved, offsetChanged: false };
  }
  return writeThreadScrollTop(scrollElement, maxTop, virtualizer);
};

export const writeThreadScrollBy = (
  scrollElement: HTMLElement,
  delta: number,
  virtualizer?: ThreadScrollVirtualizer,
  behavior: ScrollBehavior = 'instant'
): ThreadScrollWriteResult => {
  if (behavior === 'smooth') {
    const moved = Math.abs(delta) > 0.5;
    if (moved) {
      scrollElement.scrollBy({ top: delta, behavior: 'smooth' });
    }
    const actual = scrollElement.scrollTop;
    return { actual, moved, offsetChanged: false };
  }
  return writeThreadScrollTop(scrollElement, scrollElement.scrollTop + delta, virtualizer);
};

export const writeThreadScrollToIndex = (
  scrollElement: HTMLElement,
  virtualizer: ThreadScrollVirtualizer,
  index: number,
  align: 'start' | 'center' | 'end' = 'center'
): ThreadScrollWriteResult | undefined => {
  const offset = virtualizer.getOffsetForIndex?.(index, align);
  if (!offset) return undefined;
  return writeThreadScrollTop(scrollElement, offset[0], virtualizer);
};
