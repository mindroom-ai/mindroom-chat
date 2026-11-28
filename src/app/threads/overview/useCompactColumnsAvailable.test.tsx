// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPACT_COLUMNS_MIN_WIDTH_PX } from './compactColumnsLayout';
import { useCompactColumnsAvailable } from './useCompactColumnsAvailable';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.documentElement.style.fontSize = '';
});

describe('useCompactColumnsAvailable', () => {
  it('handles zero-arg ResizeObserver stubs by falling back to element.clientWidth', () => {
    const callbacks: Array<(...args: unknown[]) => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: (...args: unknown[]) => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      }
    );

    const el = document.createElement('div');
    let width = COMPACT_COLUMNS_MIN_WIDTH_PX - 100;
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });

    const { result } = renderHook(() => useCompactColumnsAvailable({ current: el }));
    expect(result.current).toBe(false);

    width = COMPACT_COLUMNS_MIN_WIDTH_PX + 20;
    act(() => {
      callbacks.forEach((cb) => cb());
    });
    expect(result.current).toBe(true);
  });

  it('scales the columns width threshold with root font size (Page Zoom)', async () => {
    let fontSize = '16px';
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.stubGlobal('getComputedStyle', (target: Element) =>
      target === document.documentElement
        ? ({ fontSize } as CSSStyleDeclaration)
        : realGetComputedStyle(target)
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );

    const el = document.createElement('div');
    // 1000px fits at 100% zoom (min 824px), but does NOT fit at 150% zoom (24px -> min 1236px).
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 1000 });

    const { result } = renderHook(() => useCompactColumnsAvailable({ current: el }));
    expect(result.current).toBe(true);

    fontSize = '24px';
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(false);

    // Restoring 100% zoom via root style attribute mutation re-enables Columns mode.
    fontSize = '16px';
    await act(async () => {
      document.documentElement.style.fontSize = '16px';
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
  });
});
