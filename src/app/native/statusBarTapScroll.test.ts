// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installStatusBarTapScroll, STATUS_BAR_SCROLL_TOP_EVENT } from './statusBarTapScroll';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/142.0.0.0';

const stubIOSFrames = (userAgent: string) => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal('navigator', { userAgent, platform: '', maxTouchPoints: 0 });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextId += 1;
    frames.set(nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  const stepFrame = () => {
    const due = [...frames.values()];
    frames.clear();
    due.forEach((callback) => callback(0));
  };
  return { frames, stepFrame };
};

/** A scroll area scrolled `top` down, as jsdom lays nothing out. */
const area = (parent: HTMLElement, top: number, overflowY = 'auto'): HTMLElement => {
  const element = document.createElement('div');
  element.style.overflowY = overflowY;
  element.scrollTop = top;
  element.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') element.scrollTop = options.top ?? element.scrollTop;
  });
  parent.appendChild(element);
  return element;
};

const tapUnder = (hit: Element) => {
  document.elementFromPoint = () => hit;
  window.dispatchEvent(new Event('statusTap'));
};

describe('installStatusBarTapScroll', () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('scrolls the scrolled area under the middle of the screen to its top, as a wheel turn up', () => {
    uninstall = installStatusBarTapScroll(window);
    const timeline = area(document.body, 900);
    const row = document.createElement('p');
    timeline.appendChild(row);
    const wheels: number[] = [];
    timeline.addEventListener('wheel', (event) => wheels.push(event.deltaY));

    tapUnder(row);

    expect(wheels).toEqual([-900]);
    expect(timeline.scrollTop).toBe(0);
  });

  it('passes over areas at their top and areas that do not scroll', () => {
    uninstall = installStatusBarTapScroll(window);
    const timeline = area(document.body, 400);
    const clipped = area(timeline, 50, 'hidden');
    const codeBlock = area(clipped, 0);

    tapUnder(codeBlock);

    expect(clipped.scrollTop).toBe(50);
    expect(timeline.scrollTop).toBe(0);
  });

  it('does nothing when nothing under the middle is scrolled, or once removed', () => {
    uninstall = installStatusBarTapScroll(window);
    const list = area(document.body, 0);
    tapUnder(list);
    expect(list.scrollTo).not.toHaveBeenCalled();

    list.scrollTop = 300;
    uninstall();
    uninstall = undefined;
    tapUnder(list);
    expect(list.scrollTop).toBe(300);
  });

  it('hides overflowY on iOS after wheel and before scrollTo, then restores after two frames', () => {
    const { frames, stepFrame } = stubIOSFrames(IPHONE);
    uninstall = installStatusBarTapScroll(window);
    const timeline = area(document.body, 900);
    const trace: string[] = [];

    timeline.addEventListener('wheel', () => {
      trace.push(`wheel:${timeline.style.overflowY}`);
    });
    timeline.addEventListener(STATUS_BAR_SCROLL_TOP_EVENT, () => {
      trace.push(`beforeTop:${timeline.style.overflowY}`);
    });
    timeline.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      trace.push(`scrollTo:${timeline.style.overflowY}`);
      if (typeof options === 'object') timeline.scrollTop = options.top ?? timeline.scrollTop;
    });

    tapUnder(timeline);

    expect(trace).toEqual(['wheel:auto', 'beforeTop:hidden', 'scrollTo:hidden']);
    expect(timeline.scrollTop).toBe(0);
    expect(timeline.style.overflowY).toBe('hidden');
    expect(frames.size).toBe(1);

    stepFrame();
    expect(timeline.style.overflowY).toBe('hidden');

    stepFrame();
    expect(timeline.style.overflowY).toBe('auto');
    expect(frames.size).toBe(0);
  });

  it('still targets a flick-stopped scroller on a second tap and preserves original overflowY', () => {
    const { stepFrame } = stubIOSFrames(IPHONE);
    uninstall = installStatusBarTapScroll(window);
    const timeline = area(document.body, 600, 'scroll');

    tapUnder(timeline);
    expect(timeline.scrollTop).toBe(0);
    expect(timeline.style.overflowY).toBe('hidden');

    // Still inside the two-frame flick-stop window, the scroller moved away from 0 again.
    stepFrame();
    timeline.scrollTop = 250;
    tapUnder(timeline);

    expect(timeline.scrollTop).toBe(0);
    expect(timeline.style.overflowY).toBe('hidden');

    stepFrame();
    expect(timeline.style.overflowY).toBe('hidden');
    stepFrame();
    expect(timeline.style.overflowY).toBe('scroll');
  });

  it('restores overflowY on uninstall even after a subsequent no-op tap', () => {
    const { frames } = stubIOSFrames(IPHONE);
    uninstall = installStatusBarTapScroll(window);
    const timeline = area(document.body, 500);

    tapUnder(timeline);
    expect(timeline.style.overflowY).toBe('hidden');
    expect(timeline.scrollTop).toBe(0);

    // Second tap while already at 0 is a no-op and must not drop the active flick-stop cleanup.
    tapUnder(timeline);
    expect(timeline.style.overflowY).toBe('hidden');

    uninstall();
    uninstall = undefined;
    expect(timeline.style.overflowY).toBe('auto');
    expect(frames.size).toBe(0);
  });

  it('leaves overflowY untouched on desktop', () => {
    const { frames } = stubIOSFrames(DESKTOP);
    uninstall = installStatusBarTapScroll(window);
    const timeline = area(document.body, 400);
    const overflowWrites = vi.fn();
    Object.defineProperty(timeline.style, 'overflowY', {
      get: () => 'auto',
      set: overflowWrites,
      configurable: true,
    });

    tapUnder(timeline);

    expect(timeline.scrollTop).toBe(0);
    expect(overflowWrites).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('skips the fallback scrollTo when a status-bar-scroll-top listener prevents default', () => {
    stubIOSFrames(IPHONE);
    uninstall = installStatusBarTapScroll(window);
    const timeline = area(document.body, 700);
    const listener = vi.fn((event: Event) => {
      expect(event.cancelable).toBe(true);
      event.preventDefault();
      timeline.scrollTop = 0;
    });
    timeline.addEventListener(STATUS_BAR_SCROLL_TOP_EVENT, listener);

    tapUnder(timeline);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(timeline.scrollTo).not.toHaveBeenCalled();
    expect(timeline.scrollTop).toBe(0);
  });

  it('restores both scrollers on uninstall after overlapping taps on two different scrollers', () => {
    const { frames, stepFrame } = stubIOSFrames(IPHONE);
    uninstall = installStatusBarTapScroll(window);
    const parent = area(document.body, 500, 'auto');
    const nested = area(parent, 120, 'scroll');
    const innerRow = document.createElement('p');
    nested.appendChild(innerRow);

    // First tap scrolls and flick-stops the nested scroller.
    tapUnder(innerRow);
    expect(nested.scrollTop).toBe(0);
    expect(nested.style.overflowY).toBe('hidden');
    expect(parent.scrollTop).toBe(500);
    expect(parent.style.overflowY).toBe('auto');

    // Second tap one frame later passes over nested (now at 0) and flick-stops parent.
    stepFrame();
    tapUnder(innerRow);
    expect(parent.scrollTop).toBe(0);
    expect(parent.style.overflowY).toBe('hidden');
    expect(nested.style.overflowY).toBe('hidden');
    expect(frames.size).toBe(2);

    // Uninstalling restores both active flick-stops and cancels all pending frames.
    uninstall();
    uninstall = undefined;
    expect(nested.style.overflowY).toBe('scroll');
    expect(parent.style.overflowY).toBe('auto');
    expect(frames.size).toBe(0);
  });

  it('releases active flick-stop handles after two frames complete', () => {
    const { frames, stepFrame } = stubIOSFrames(IPHONE);
    uninstall = installStatusBarTapScroll(window);
    const timeline = area(document.body, 400, 'auto');

    tapUnder(timeline);
    expect(timeline.style.overflowY).toBe('hidden');
    stepFrame();
    stepFrame();
    expect(timeline.style.overflowY).toBe('auto');
    expect(frames.size).toBe(0);

    // After the two-frame stop finishes, uninstall should not touch the element's overflowY again.
    const overflowWrites = vi.fn();
    Object.defineProperty(timeline.style, 'overflowY', {
      get: () => 'auto',
      set: overflowWrites,
      configurable: true,
    });
    uninstall();
    uninstall = undefined;
    expect(overflowWrites).not.toHaveBeenCalled();
  });
});
