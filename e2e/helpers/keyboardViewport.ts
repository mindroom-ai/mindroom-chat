import type { BrowserContext } from '@playwright/test';

declare global {
  interface Window {
    __setKeyboardViewport?: (
      height: number,
      offsetTop: number,
      eventName: string,
      width?: number
    ) => void;
  }
}

/** A visualViewport whose size the test sets, as Safari's keyboard changes it. */
export const standInVisualViewport = (context: BrowserContext) =>
  context.addInitScript(() => {
    let height: number | undefined;
    let width: number | undefined;
    let offsetTop = 0;
    const events = new EventTarget();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        get width() {
          return width ?? window.innerWidth;
        },
        get height() {
          return height ?? window.innerHeight;
        },
        get offsetLeft() {
          return 0;
        },
        get offsetTop() {
          return offsetTop;
        },
        get pageLeft() {
          return 0;
        },
        get pageTop() {
          return offsetTop;
        },
        get scale() {
          return 1;
        },
      },
    });
    window.__setKeyboardViewport = (nextHeight, nextOffsetTop, eventName, nextWidth) => {
      height = nextHeight;
      width = nextWidth;
      offsetTop = nextOffsetTop;
      events.dispatchEvent(new Event(eventName));
    };
  });
