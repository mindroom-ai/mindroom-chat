// @vitest-environment jsdom
import { createRef } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useFooterBottomPin } from './useFooterBottomPin';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The pin on a scroll area 600 px tall over 3000 px of rows, with the reader at the bottom.
 * `resize` is one report of its ResizeObserver; `wheelTo` is the reader's own scroll.
 */
const mount = () => {
  const reports: (() => void)[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(report: () => void) {
        reports.push(report);
      }

      observe() {}

      disconnect() {}
    }
  );
  const layout = { width: 700.109375 };
  const scrollListeners: (() => void)[] = [];
  const scroll = {
    scrollHeight: 3000,
    clientHeight: 600,
    scrollTop: 2400,
    // A width that crosses no whole pixel keeps this.
    clientWidth: 700,
    getBoundingClientRect: () => ({ width: layout.width }),
    addEventListener: (_type: string, listener: () => void) => scrollListeners.push(listener),
    removeEventListener() {},
  };
  const probeRef = createRef<HTMLElement>();
  Object.assign(probeRef, { current: { offsetHeight: 80 } });
  const followLatestRows = vi.fn();
  function Pin() {
    useFooterBottomPin(scroll as unknown as HTMLElement, probeRef, followLatestRows);
    return null;
  }
  act(() => {
    create(<Pin />);
  });
  return {
    followLatestRows,
    layout,
    resize: () => reports.forEach((report) => report()),
    wheelTo: (scrollTop: number) => {
      scroll.scrollTop = scrollTop;
      scrollListeners.forEach((listener) => listener());
    },
  };
};

it('follows the newest row when a width change of a fraction of a pixel wraps the rows anew', () => {
  const { followLatestRows, layout, resize, wheelTo } = mount();
  // The reader wheels up into the history and back down to the bottom: no Jump to Latest, so
  // nothing but this pin asks the timeline to follow its newest row.
  wheelTo(1800);
  wheelTo(2400);
  // 0.2 px narrower, at the same rounded width: a word no longer fits its line.
  layout.width = 699.90625;
  resize();
  expect(followLatestRows).toHaveBeenCalledTimes(1);
});

it('leaves a reader up in the history alone at a new width', () => {
  const { followLatestRows, layout, resize, wheelTo } = mount();
  wheelTo(1800);
  layout.width = 640;
  resize();
  expect(followLatestRows).not.toHaveBeenCalled();
});
