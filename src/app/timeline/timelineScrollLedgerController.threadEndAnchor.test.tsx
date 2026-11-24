// @vitest-environment jsdom
import { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';

const ROW_HEIGHT = 100;
const VIEWPORT_HEIGHT = 600;
const HEADER_PX = 120;
const COMPOSER_PX = 120;

describe('thread end-anchoring uses real scroller distance from bottom', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
  });

  const mountThread = (initialScrollTop: number) => {
    const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const prevActEnv = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;

    const mounted: {
      virtualizer?: ReturnType<typeof useTimelineScrollLedgerController>['virtualizer'];
    } = {};
    let renderedListHeight = 0;

    const scrollElement = document.createElement('div');
    scrollElement.scrollTop = initialScrollTop;
    Object.defineProperties(scrollElement, {
      clientWidth: { value: 390, configurable: true },
      clientHeight: { value: VIEWPORT_HEIGHT, configurable: true },
      offsetWidth: { value: 390, configurable: true },
      offsetHeight: { value: VIEWPORT_HEIGHT, configurable: true },
      scrollHeight: {
        get: () => HEADER_PX + renderedListHeight + COMPOSER_PX,
        configurable: true,
      },
    });
    scrollElement.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === 'object' && options.top !== undefined) {
        const max = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
        scrollElement.scrollTop = Math.min(Math.max(0, options.top), max);
      }
    });
    document.body.appendChild(scrollElement);

    const root = createRoot(scrollElement);
    dispose = () => {
      flushSync(() => root.unmount());
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    };

    function ThreadHarness({ keys }: { keys: string[] }) {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef(() => ROW_HEIGHT);
      const alive = useCallback(() => true, []);
      const getScrollElement = useCallback(() => scrollElement, []);
      const controller = useTimelineScrollLedgerController({
        alive,
        estimateSize: () => ROW_HEIGHT,
        getItemKey: (index) => keys[index] ?? index,
        getScrollElement,
        itemCount: keys.length,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadId: '$thread-1',
      });
      mounted.virtualizer = controller.virtualizer;
      renderedListHeight = controller.virtualizer.getTotalSize();
      controller.virtualizer.getVirtualItems();
      return <div ref={controller.virtualInnerRef} style={{ height: renderedListHeight }} />;
    }

    const initialKeys = Array.from({ length: 50 }, (_, i) => `$m-${i}`);
    const render = (keys: string[]) => flushSync(() => root.render(<ThreadHarness keys={keys} />));
    render(initialKeys);
    scrollElement.scrollTop = initialScrollTop;
    scrollElement.dispatchEvent(new Event('scroll'));
    render(initialKeys);

    return {
      scrollElement,
      initialKeys,
      render,
      getVirtualizer: () => {
        if (!mounted.virtualizer) throw new Error('Virtualizer never mounted');
        return mounted.virtualizer;
      },
    };
  };

  it('does not pull a reader 120px above the real bottom when the last reply grows by 200px', () => {
    // Real scrollHeight = 120 (header) + 5000 (list) + 120 (composer) = 5240.
    // Real bottom = 5240 - 600 = 4640. Reader is 120px above real bottom at 4520.
    // Virtual list end alone is 5000 - 600 = 4400 (< 4520), so list-only end
    // anchoring would falsely treat the reader as pinned and pull them +200px.
    const readerTop = HEADER_PX + 50 * ROW_HEIGHT + COMPOSER_PX - VIEWPORT_HEIGHT - 120;
    const { scrollElement, getVirtualizer } = mountThread(readerTop);
    expect(scrollElement.scrollTop).toBe(4520);

    getVirtualizer().resizeItem(49, ROW_HEIGHT + 200);

    expect(scrollElement.scrollTop).toBe(4520);
  });

  it('follows a growing last reply when the reader is at the real bottom', () => {
    const realBottom = HEADER_PX + 50 * ROW_HEIGHT + COMPOSER_PX - VIEWPORT_HEIGHT;
    const { scrollElement, getVirtualizer } = mountThread(realBottom);
    expect(scrollElement.scrollTop).toBe(4640);

    getVirtualizer().resizeItem(49, ROW_HEIGHT + 200);

    expect(scrollElement.scrollTop).toBe(4840);
  });

  it('keeps key-based prepend anchoring while scrolled 120px above the real bottom', () => {
    const readerTop = HEADER_PX + 50 * ROW_HEIGHT + COMPOSER_PX - VIEWPORT_HEIGHT - 120;
    const { scrollElement, initialKeys, render } = mountThread(readerTop);
    expect(scrollElement.scrollTop).toBe(4520);

    const prepended = [...Array.from({ length: 10 }, (_, i) => `$older-${i}`), ...initialKeys];
    render(prepended);

    expect(scrollElement.scrollTop).toBe(4520 + 10 * ROW_HEIGHT);
  });
});
