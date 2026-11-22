import { expect, type Locator } from '@playwright/test';

export const COMPACT_VIEW = '[data-compact-room-view]';

/**
 * The Compact list has `count` cards (or at least that many) and has measured where they end.
 * It mounts a window of them, so the cards in the page say neither.
 */
export const expectCompactCardCount = async (
  view: Locator,
  count: number,
  { atLeast = false, timeout = 180_000 } = {}
) => {
  const listed = expect.poll(
    async () => Number((await view.getAttribute('data-compact-card-count')) ?? -1),
    { timeout }
  );
  await (atLeast ? listed.toBeGreaterThanOrEqual(count) : listed.toBe(count));
  await expect(view).not.toHaveAttribute('data-cards-pending', 'true', { timeout });
};

/** Read cards as they enter the Compact scroller, stopping at a selector or after seeing roots. */
export const walkCompactCards = (view: Locator, stopAt?: string | string[]) =>
  view.evaluate(async (scroller, stop) => {
    const seen = new Set<string>();
    const intersects = (element: Element, area: DOMRect) => {
      const rect = element.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > area.top && rect.top < area.bottom;
    };
    scroller.scrollTop = 0;
    for (let step = 0; step < 2_000 && scroller.isConnected; step += 1) {
      // A scroll event has to render the new window before we read it.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const area = scroller.getBoundingClientRect();
      scroller
        .querySelectorAll<HTMLElement>('button[data-thread-root-id]:not([inert] *)')
        .forEach((card) => {
          const id = card.dataset.threadRootId;
          if (id && intersects(card, area)) seen.add(id);
        });
      const found = typeof stop === 'string' && scroller.querySelector(stop);
      if (found && intersects(found, area)) return [...seen];
      if (Array.isArray(stop) && stop.every((id) => seen.has(id))) break;
      const { scrollTop, clientHeight, scrollHeight } = scroller;
      if (scrollTop + clientHeight >= scrollHeight - 1) break;
      scroller.scrollTop = scrollTop + clientHeight / 2;
    }
    if (typeof stop === 'string') throw new Error(`Did not scroll to ${stop} in Compact`);
    return [...seen];
  }, stopAt);
