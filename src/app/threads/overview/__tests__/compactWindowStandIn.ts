import { afterEach, beforeEach, vi } from 'vitest';

// Give the real virtualizer a viewport and measured rows in jsdom, without mocking its range.
beforeEach(() => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')?.get;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height(
    this: HTMLElement
  ) {
    if (this.hasAttribute('data-compact-room-view')) return 800;
    if (this.hasAttribute('data-index'))
      return this.querySelector('[data-compact-section]') ? 44 : 84;
    return original?.call(this) ?? 0;
  });
  if (!HTMLElement.prototype.scrollTo) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        if (options.top !== undefined) this.scrollTop = options.top;
      },
    });
  }
  if (typeof ResizeObserver === 'undefined') {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
