// @vitest-environment jsdom
import { createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InsetScrollbar } from './InsetScrollbar';

describe('InsetScrollbar', () => {
  let host: HTMLDivElement;
  let root: Root;
  let scroll: HTMLDivElement;
  let track: HTMLDivElement;
  let thumb: HTMLDivElement;
  let resize: () => void;
  let frame: FrameRequestCallback | undefined;
  let trackHeight: number;
  let contentHeight: number;
  let scrollRef = createRef<HTMLDivElement>();
  let contentRef = createRef<HTMLDivElement>();
  const disconnect = vi.fn();
  const mountBar = (beforeEnd?: () => void) =>
    act(() =>
      root.render(
        <div ref={scrollRef}>
          <div ref={contentRef} />
          <InsetScrollbar
            scrollRef={scrollRef}
            contentRef={contentRef}
            label="Messages"
            className="placement"
            beforeEnd={beforeEnd}
          />
        </div>
      )
    );

  const flush = () => {
    const pending = frame;
    frame = undefined;
    pending?.(0);
  };
  const key = (value: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    track.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      })
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn(() => {
        frame = undefined;
      })
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }

        observe() {}

        disconnect = disconnect;
      }
    );
    trackHeight = 300;
    contentHeight = 1500;
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function getHeight(
      this: HTMLElement
    ) {
      return this.getAttribute('role') === 'scrollbar' ? trackHeight : 500;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => contentHeight);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    scrollRef = createRef<HTMLDivElement>();
    contentRef = createRef<HTMLDivElement>();
    mountBar();
    scroll = scrollRef.current!;
    track = host.querySelector('[role="scrollbar"]')!;
    thumb = track.firstElementChild as HTMLDivElement;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    disconnect.mockClear();
  });

  it('tracks native scrolling, clamps overscroll, and coalesces scroll events', () => {
    expect(track.getAttribute('aria-controls')).toBe(scroll.id);
    expect(track.getAttribute('aria-valuemax')).toBe('1000');
    scroll.scrollTop = 500;
    scroll.dispatchEvent(new Event('scroll'));
    scroll.dispatchEvent(new Event('scroll'));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    flush();
    expect(track.getAttribute('aria-valuenow')).toBe('500');
    expect(track.dataset.active).toBe('true');
    scroll.scrollTop = -30;
    scroll.dispatchEvent(new Event('scroll'));
    flush();
    expect(thumb.style.transform).toBe('translateY(0px)');
    expect(track.getAttribute('aria-valuenow')).toBe('0');
    scroll.scrollTop = 1200;
    scroll.dispatchEvent(new Event('scroll'));
    flush();
    expect(track.getAttribute('aria-valuenow')).toBe('1000');
    vi.advanceTimersByTime(900);
    expect(track.dataset.active).toBe('false');
  });

  it('hides when content fits and recovers after content or control resizing', () => {
    contentHeight = 500;
    resize();
    flush();
    expect(track.dataset.overflow).toBe('false');
    trackHeight = 0;
    resize();
    flush();
    expect(thumb.style.height).toBe('0px');
    contentHeight = 2000;
    trackHeight = 400;
    resize();
    flush();
    expect(track.dataset.overflow).toBe('true');
    expect(track.getAttribute('aria-valuemax')).toBe('1500');
    const previousHeight = Number.parseFloat(thumb.style.height);
    trackHeight = 200;
    resize();
    flush();
    expect(Number.parseFloat(thumb.style.height)).toBeLessThan(previousHeight);
  });

  it('supports keyboard navigation and preserves ancestor user-intent listeners', () => {
    const intent = vi.fn();
    scroll.addEventListener('keydown', intent);
    expect(key('End').defaultPrevented).toBe(true);
    expect(scroll.scrollTop).toBe(1000);
    key('PageUp');
    expect(scroll.scrollTop).toBe(700);
    key('ArrowUp');
    expect(scroll.scrollTop).toBe(660);
    key('ArrowDown');
    expect(scroll.scrollTop).toBe(700);
    key('Home');
    expect(scroll.scrollTop).toBe(0);
    key('PageDown');
    expect(scroll.scrollTop).toBe(300);
    expect(intent).toHaveBeenCalledTimes(6);
    expect(key('End', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key('Escape').defaultPrevented).toBe(false);
    expect(scroll.scrollTop).toBe(300);
  });

  it('runs beforeEnd only on unmodified End and preserves an active drag across prop changes', () => {
    const beforeEnd = vi.fn(() => {
      contentHeight = 2100;
    });
    mountBar(beforeEnd);
    key('PageDown');
    key('Home');
    expect(beforeEnd).not.toHaveBeenCalled();
    key('End');
    expect(beforeEnd).toHaveBeenCalledTimes(1);
    expect(scroll.scrollTop).toBe(1600);
    key('End', { ctrlKey: true });
    expect(beforeEnd).toHaveBeenCalledTimes(1);

    mountBar();
    track.setPointerCapture = vi.fn();
    track.hasPointerCapture = vi.fn(() => false);
    const pointer = (type: string, clientY: number) => {
      const event = new MouseEvent(type, { button: 0, clientY, bubbles: true, cancelable: true });
      Object.defineProperties(event, { isPrimary: { value: true }, pointerId: { value: 1 } });
      track.dispatchEvent(event);
    };
    const blocked = () => document.documentElement.hasAttribute('data-drag-no-select');
    pointer('pointerdown', 100);
    const pressed = scroll.scrollTop;
    mountBar(() => {});
    expect(blocked()).toBe(true);
    pointer('pointermove', 200);
    expect(scroll.scrollTop).toBeGreaterThan(pressed);
    pointer('pointerup', 200);
    expect(blocked()).toBe(false);
  });

  it.each([0, -1] as const)('preserves composite focus when tabIndex is %s', (tabIndex) => {
    const scrollRef = createRef<HTMLDivElement>();
    const contentRef = createRef<HTMLDivElement>();
    act(() =>
      root.render(
        <div ref={scrollRef}>
          <input aria-label="Search" />
          <div ref={contentRef} />
          <InsetScrollbar
            scrollRef={scrollRef}
            contentRef={contentRef}
            label="Options"
            className="placement"
            tabIndex={tabIndex}
          />
        </div>
      )
    );
    const input = host.querySelector('input')!;
    const bar = host.querySelector<HTMLElement>('[role="scrollbar"]')!;
    bar.setPointerCapture = vi.fn();
    input.focus();
    const event = new MouseEvent('pointerdown', {
      button: 0,
      clientY: 180,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperties(event, { isPrimary: { value: true }, pointerId: { value: 1 } });
    bar.dispatchEvent(event);
    expect(scrollRef.current!.scrollTop).toBeGreaterThan(0);
    expect(document.activeElement).toBe(tabIndex === -1 ? input : bar);
  });

  it.each(['pointerup', 'pointercancel', 'lostpointercapture', 'unmount'])(
    'keeps the page from selecting text while a drag runs, until %s',
    (end) => {
      track.setPointerCapture = vi.fn();
      track.hasPointerCapture = vi.fn(() => false);
      const pointer = (type: string) => {
        const event = new MouseEvent(type, { button: 0, bubbles: true, cancelable: true });
        Object.defineProperties(event, { isPrimary: { value: true }, pointerId: { value: 1 } });
        track.dispatchEvent(event);
        return event;
      };
      const blocked = () => document.documentElement.hasAttribute('data-drag-no-select');
      expect(pointer('pointerdown').defaultPrevented).toBe(true);
      expect(blocked()).toBe(true);
      const selectStart = new Event('selectstart', { bubbles: true, cancelable: true });
      scroll.dispatchEvent(selectStart);
      expect(selectStart.defaultPrevented).toBe(true);
      if (end === 'unmount') act(() => root.render(null));
      else pointer(end);
      expect(blocked()).toBe(false);
      const after = new Event('selectstart', { bubbles: true, cancelable: true });
      document.body.dispatchEvent(after);
      expect(after.defaultPrevented).toBe(false);
    }
  );

  it('ends a drag when the page is left mid-drag, and takes the next press', () => {
    const blocked = () => document.documentElement.hasAttribute('data-drag-no-select');
    const pointer = (type: string) => {
      const event = new MouseEvent(type, { button: 0, bubbles: true, cancelable: true });
      Object.defineProperties(event, { isPrimary: { value: true }, pointerId: { value: 1 } });
      track.dispatchEvent(event);
    };
    track.setPointerCapture = vi.fn();
    track.hasPointerCapture = vi.fn(() => false);
    pointer('pointerdown');
    // Back with the mouse held: the page comes back from the cache without the drag's end.
    window.dispatchEvent(new Event('pagehide'));
    expect(blocked()).toBe(false);
    pointer('pointerdown');
    expect(blocked()).toBe(true);
    pointer('pointerup');
    expect(blocked()).toBe(false);
  });

  it('takes one drag at a time, and no hold without the pointer capture', () => {
    const blocked = () => document.documentElement.hasAttribute('data-drag-no-select');
    const pointer = (type: string, pointerId: number) => {
      const event = new MouseEvent(type, { button: 0, bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        isPrimary: { value: true },
        pointerId: { value: pointerId },
      });
      track.dispatchEvent(event);
    };
    track.setPointerCapture = vi.fn(() => {
      throw new DOMException('No active pointer', 'NotFoundError');
    });
    const thrown = vi.fn((event: ErrorEvent) => event.preventDefault());
    window.addEventListener('error', thrown);
    pointer('pointerdown', 1);
    window.removeEventListener('error', thrown);
    expect(thrown).toHaveBeenCalledOnce();
    expect(blocked()).toBe(false);
    track.setPointerCapture = vi.fn();
    track.hasPointerCapture = vi.fn(() => false);
    // A mouse and a pen are each primary for their own kind of pointer.
    pointer('pointerdown', 1);
    pointer('pointerdown', 2);
    pointer('pointerup', 2);
    expect(blocked()).toBe(true);
    pointer('pointerup', 1);
    expect(blocked()).toBe(false);
  });

  it('cleans up observers, scheduled work, and event listeners when unmounted', () => {
    scroll.dispatchEvent(new Event('scroll'));
    expect(frame).toBeDefined();
    act(() => root.render(null));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(frame).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(scroll.id).toBe('');
    vi.mocked(requestAnimationFrame).mockClear();
    scroll.dispatchEvent(new Event('scroll'));
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('skips DOM attribute and style writes when resize leaves scroll geometry unchanged', () => {
    const setAttribute = vi.spyOn(track, 'setAttribute');
    const setHeight = vi.spyOn(thumb.style, 'height', 'set');
    const setTransform = vi.spyOn(thumb.style, 'transform', 'set');

    resize();
    flush();

    expect(setAttribute).not.toHaveBeenCalled();
    expect(setHeight).not.toHaveBeenCalled();
    expect(setTransform).not.toHaveBeenCalled();

    contentHeight = 2000;
    resize();
    flush();

    expect(setAttribute).toHaveBeenCalledWith('aria-valuemax', '1500');
    expect(setHeight).toHaveBeenCalledTimes(1);
    expect(setTransform).not.toHaveBeenCalled();
  });
});
