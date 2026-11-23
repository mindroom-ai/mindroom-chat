import { act } from '@testing-library/react';
import { vi } from 'vitest';

export type CompactLayoutOptions = {
  viewAttr?: string;
  width?: () => number;
  clientHeight?: number;
  gap?: number;
  inset?: () => number;
  clampScrollTop?: boolean;
  rowHeight?: (row: HTMLElement) => number;
};

export const tickFrames = (frames: number): void => {
  for (let i = 0; i < frames; i += 1) {
    act(() => {
      vi.advanceTimersByTime(17);
    });
  }
};

export const defaultRowHeight = (row: HTMLElement): number =>
  row.style.display === 'none'
    ? 0
    : Number.parseFloat(row.style.height) || (row.hasAttribute('data-scroll-anchor') ? 100 : 0);

export function stubCompactLayout({
  viewAttr = 'data-compact-room-view',
  width = () => 300,
  clientHeight = 300,
  gap = 0,
  inset = () => 0,
  clampScrollTop = false,
  rowHeight = defaultRowHeight,
}: CompactLayoutOptions = {}) {
  let scrollTop = 0;
  let observers = 0;
  const callbacks = new Set<() => void>();
  const isView = (el: Element | null | undefined) => !!el?.hasAttribute(viewAttr);
  const extent = () =>
    [
      ...document.querySelectorAll<HTMLElement>('[data-scroll-anchor], [data-compact-spacer]'),
    ].reduce((sum, row) => sum + rowHeight(row), 0);

  vi.stubGlobal(
    'ResizeObserver',
    class {
      private cb: () => void;
      observe = vi.fn();
      unobserve = vi.fn();
      constructor(cb: () => void) {
        observers += 1;
        this.cb = cb;
        callbacks.add(cb);
      }
      disconnect = () => void callbacks.delete(this.cb);
    }
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
    this: HTMLElement
  ) {
    const w = width();
    if (w === 0) return new DOMRect();
    if (isView(this)) return new DOMRect(0, 0, w, clientHeight);
    const offset = clampScrollTop
      ? scrollTop
      : this.closest<HTMLElement>(`[${viewAttr}]`)?.scrollTop ?? 0;
    if (isView(this.parentElement))
      return new DOMRect(
        0,
        -offset,
        w,
        Math.max(extent(), Number.parseFloat(this.style.minHeight) || 0)
      );
    let top = inset() - offset;
    for (
      let row = this.previousElementSibling;
      row instanceof HTMLElement;
      row = row.previousElementSibling
    )
      if (row.style.display !== 'none') top += rowHeight(row) + gap;
    return new DOMRect(0, top, w, this.style.display === 'none' ? 0 : rowHeight(this));
  });
  if (clampScrollTop) {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
      () => inset() + extent()
    );
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(() => scrollTop);
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation((value: number) => {
      scrollTop = Math.min(Math.max(0, value), Math.max(0, inset() + extent() - clientHeight));
    });
  }
  return {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = value;
    },
    get observers() {
      return observers;
    },
    extent,
    resize: () => [...callbacks].forEach((cb) => cb()),
    scroll: (view: HTMLElement, top: number) =>
      act(() => {
        if (clampScrollTop) scrollTop = top;
        else view.scrollTop = top;
        view.dispatchEvent(new Event('scroll'));
      }),
  };
}
