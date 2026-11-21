import { setTimeout as sleep } from 'node:timers/promises';
import { expect, type Locator, type Page } from '@playwright/test';

export const getThreadOverviewSortButton = (page: Page) =>
  page.locator('[data-room-thread-overview="true"] button[data-sort-by]');

/**
 * Turns off the thread filter bar's resolved filter, simple or advanced, so resolved threads show:
 * a Compact room opens with them hidden.
 */
export const showResolvedThreads = async (page: Page) => {
  const overview = page.locator('[data-room-thread-overview="true"]');
  const simple = overview.locator('[data-simple-unresolved-toggle]');
  const advanced = overview.locator('[data-thread-tab="all"]');
  await expect(async () => {
    if ((await simple.count()) > 0) {
      if ((await simple.getAttribute('aria-pressed')) === 'true') await simple.click();
      await expect(simple).toHaveAttribute('aria-pressed', 'false', { timeout: 2_000 });
      return;
    }
    await advanced.click();
    await expect(advanced).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
};

/** Keeps a sticky record of any loss of the hold, including one a later move reacquired. */
const watchMouseOrderHold = (page: Page) =>
  page.evaluateHandle(() => {
    const attribute = 'data-order-held';
    const held = document.querySelector(`[data-compact-room-view] [${attribute}]`);
    if (!held) throw new Error('Compact order was no longer held when the observer started');
    const win = window as Window & { compactMouseOrderDropped?: boolean };
    win.compactMouseOrderDropped = false;
    const recordDrops = (records: MutationRecord[]) => {
      if (
        !held.hasAttribute(attribute) ||
        !held.isConnected ||
        records.some((record) =>
          record.type === 'attributes'
            ? record.oldValue === null // The attribute was added back before delivery.
            : Array.from(record.removedNodes).some((node) => node.contains(held))
        )
      ) {
        win.compactMouseOrderDropped = true;
      }
    };
    const observer = new MutationObserver(recordDrops);
    observer.observe(held, { attributeFilter: [attribute], attributeOldValue: true });
    // The cards or an ancestor can be replaced even if the new element also holds the order.
    observer.observe(document, { childList: true, subtree: true });
    return (disconnect: boolean) => {
      recordDrops(observer.takeRecords());
      const dropped = win.compactMouseOrderDropped;
      if (disconnect) {
        observer.disconnect();
        delete win.compactMouseOrderDropped;
      }
      return dropped;
    };
  });

/** Keeps the mouse moving over the Compact list while the test waits for a live update. */
export const withMovingMouseOverCard = async <T>(
  page: Page,
  card: Locator,
  run: (point: { x: number; y: number }) => Promise<T>
): Promise<T> => {
  const box = await card.boundingBox();
  if (!box) throw new Error('No card to point at');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('[data-compact-room-view] [data-order-held]')).toHaveCount(1);
  const watch = await watchMouseOrderHold(page);
  const expectUnbrokenHold = async (disconnect = false) => {
    expect(
      await watch.evaluate((read, stop) => read(stop), disconnect),
      'the Compact order hold never dropped while the mouse was moving'
    ).toBe(false);
  };

  const controller = new AbortController();
  const { signal } = controller;
  const tick = async (dx: number) => {
    const start = performance.now();
    await page.mouse.move(point.x + dx, point.y);
    // Count the move's own time towards the 200 ms between tick starts.
    await sleep(Math.max(0, 200 - (performance.now() - start)), undefined, { signal }).catch(
      (error: unknown) => {
        if (!signal.aborted) throw error;
      }
    );
  };
  const nudge = async () => {
    let dx = 1;
    while (!signal.aborted) {
      // eslint-disable-next-line no-await-in-loop
      await tick(dx);
      dx = 1 - dx;
    }
  };
  const update = async () => {
    try {
      const result = await run(point);
      await expectUnbrokenHold();
      return result;
    } finally {
      controller.abort();
    }
  };

  const nudging = nudge();
  const updating = update();
  let failed = false;
  try {
    const [result] = await Promise.all([updating, nudging]);
    return result;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    controller.abort();
    // A failed move must not leave the test's update running after this helper has exited.
    await Promise.allSettled([updating, nudging]);
    await expectUnbrokenHold(true)
      .finally(() => watch.dispose())
      .catch((error: unknown) => {
        // Keep the original failure if the final check or cleanup also fails.
        if (!failed) throw error;
      });
  }
};
