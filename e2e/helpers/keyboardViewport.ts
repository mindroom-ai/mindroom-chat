import type { BrowserContext, Locator } from '@playwright/test';

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

/**
 * What covers the box of the composer around `editable`: the points sampled in it whose top
 * element is not inside it, none while it is uncovered. `inRoomArea` samples only the part of
 * the box inside the room area, which cuts a composer taller than the band a keyboard leaves.
 */
export const composerUncovered = (editable: Locator, inRoomArea = false) =>
  editable.evaluate((element, clip) => {
    let box = element.parentElement;
    while (box) {
      const style = getComputedStyle(box);
      if (style.overflow === 'hidden' && style.borderTopLeftRadius !== '0px') break;
      box = box.parentElement;
    }
    if (!box) return ['no composer box'];
    const rect = box.getBoundingClientRect();
    // The room area holds the conversation, which ends in the footer.
    const area = clip
      ? document.querySelector('[data-room-footer]')?.parentElement?.parentElement
      : undefined;
    const within = area?.getBoundingClientRect() ?? rect;
    const top = Math.max(rect.top, within.top);
    const bottom = Math.min(rect.bottom, within.bottom);
    if (bottom - top < 16) return [`${Math.round(bottom - top)} px of the composer shows`];
    const x = rect.left + rect.width / 2;
    return [top + 4, (top + bottom) / 2, bottom - 4]
      .map((y) => ({ y, hit: document.elementFromPoint(x, y) }))
      .filter(({ hit }) => !hit || !box?.contains(hit))
      .map(
        ({ y, hit }) => `${Math.round(y)}: ${hit?.tagName ?? 'nothing'} ${hit?.className ?? ''}`
      );
  }, inRoomArea);
