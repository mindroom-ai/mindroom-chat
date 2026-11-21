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
    let dropped = false;
    const chain = new Set<Node>();
    const recordDrops = (records: MutationRecord[]) => {
      if (
        !held.hasAttribute(attribute) ||
        !held.isConnected ||
        records.some((record) =>
          record.type === 'attributes'
            ? record.oldValue === null // The attribute was added back before delivery.
            : Array.from(record.removedNodes).some((node) => chain.has(node))
        )
      ) {
        dropped = true;
      }
    };
    const observer = new MutationObserver(recordDrops);
    observer.observe(held, { attributeFilter: [attribute], attributeOldValue: true });
    // Watch the held element's removal or replacement, including via an ancestor.
    for (let node: Node = held; node.parentNode; node = node.parentNode) {
      chain.add(node);
      observer.observe(node.parentNode, { childList: true });
    }
    return {
      finish: () => {
        recordDrops(observer.takeRecords());
        observer.disconnect();
        return dropped;
      },
      disconnect: () => observer.disconnect(),
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
    await expect(page.locator('[data-compact-room-view] [data-order-held]')).toHaveCount(1);
    const watch = await watchMouseOrderHold(page);
    let finished = false;
    try {
      const result = await run(point);
      const dropped = await watch.evaluate((observer) => observer.finish());
      finished = true;
      expect(dropped, 'the Compact order hold never dropped while the mouse was moving').toBe(
        false
      );
      return result;
    } finally {
      if (!finished) await watch.evaluate((observer) => observer.disconnect()).catch(() => {});
      await watch.dispose().catch(() => {});
    }
  };

  let nudging: Promise<void> | undefined;
  let updating: Promise<T> | undefined;
  try {
    await page.mouse.move(point.x, point.y);
    nudging = nudge();
    updating = update().finally(() => controller.abort());
    const [result] = await Promise.all([updating, nudging]);
    return result;
  } finally {
    controller.abort();
    // A failed move must not leave the test's update running after this helper has exited.
    await Promise.allSettled([updating, nudging]);
  }
};
