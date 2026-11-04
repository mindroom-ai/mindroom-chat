// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TIMELINE_OVERLAY_ATTRIBUTE,
  isKeyboardFocus,
  useToolbarClearance,
} from './hoverToolbarPlacement';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('isKeyboardFocus', () => {
  it('counts focus the browser shows as keyboard focus', () => {
    expect(isKeyboardFocus({ matches: () => true } as unknown as Element)).toBe(true);
  });

  it('ignores the focus a click leaves on the row', () => {
    expect(isKeyboardFocus({ matches: () => false } as unknown as Element)).toBe(false);
    expect(isKeyboardFocus(null)).toBe(false);
  });

  it('counts the focus where the engine does not know the selector', () => {
    const element = {
      matches: () => {
        throw new SyntaxError('unknown pseudo-class');
      },
    };
    expect(isKeyboardFocus(element as unknown as Element)).toBe(true);
  });
});

type Rect = { top: number; bottom: number; left: number; right: number };
const rectOf = ({ top, bottom, left, right }: Rect) =>
  ({
    top,
    bottom,
    left,
    right,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
  } as DOMRect);

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  vi.restoreAllMocks();
});

/**
 * A scroller whose visible rows start at y=100 (its scroll padding), with an `[+all]`-like
 * control from y=110 to 130 at the right, and a row at `rowTop` whose toolbar normally sits 30 px
 * above it at the right edge.
 */
const renderRow = (rowTop: number, overlayLeft = 900) => {
  const seen: Array<number | undefined> = [];
  function Row() {
    const rowRef = useRef<HTMLDivElement>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const clearance = useToolbarClearance(rowRef, toolbarRef, true);
    seen.push(clearance);
    return (
      <div data-testid="scroller" style={{ overflowY: 'auto', scrollPaddingTop: '100px' }}>
        <div {...{ [TIMELINE_OVERLAY_ATTRIBUTE]: '' }} data-testid="overlay" />
        <div ref={rowRef} data-testid="row">
          <div ref={toolbarRef} data-testid="toolbar" />
        </div>
      </div>
    );
  }
  const rects: Record<string, Rect> = {
    scroller: { top: 0, bottom: 800, left: 0, right: 1000 },
    overlay: { top: 110, bottom: 130, left: overlayLeft, right: overlayLeft + 50 },
    row: { top: rowTop, bottom: rowTop + 80, left: 0, right: 1000 },
    toolbar: { top: rowTop - 30, bottom: rowTop + 6, left: 850, right: 1000 },
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
    this: HTMLElement
  ) {
    return rectOf(rects[this.dataset.testid ?? ''] ?? { top: 0, bottom: 0, left: 0, right: 0 });
  });
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = computed(element);
    if ((element as HTMLElement).dataset?.testid !== 'scroller') return style;
    return { ...style, overflowY: 'auto', scrollPaddingTop: '100px' } as CSSStyleDeclaration;
  });
  host = document.createElement('div');
  document.body.append(host);
  act(() => {
    root = createRoot(host!);
    root.render(<Row />);
  });
  return seen.at(-1);
};

describe('useToolbarClearance', () => {
  it('keeps the usual place above a row with room above it', () => {
    expect(renderRow(400)).toBeUndefined();
  });

  it('moves the toolbar of the row right under the [+all] toggle below the toggle', () => {
    // The toggle ends at 130, plus a 4 px gap; the row starts at 140.
    expect(renderRow(140)).toBe(-6);
  });

  it('moves the toolbar of a row under the sticky header into the visible part of the row', () => {
    // No overlay over the toolbar; the visible rows start at 100.
    expect(renderRow(90, 100)).toBe(10);
  });
});
