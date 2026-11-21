import { setTimeout as sleep } from 'node:timers/promises';
import { expect, type Locator, type Page } from '@playwright/test';

/** Keeps the mouse aiming at a card while the test waits for a live update. */
export const withMovingMouseOverCard = async <T>(
  page: Page,
  card: Locator,
  run: (point: { x: number; y: number }) => Promise<T>
): Promise<T> => {
  const cardCenter = async () => {
    const box = await card.boundingBox();
    if (!box) throw new Error('No card to point at');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const point = await cardCenter();
  await page.mouse.move(point.x, point.y);
  const held = page.locator('[data-order-held]');
  await expect(held).toHaveCount(1);
  const expectStillHeld = async () => {
    expect(await held.count(), 'order is still held by the moving mouse').toBe(1);
  };

  let done = false;
  const update = async () => {
    try {
      const result = await run(point);
      await expectStillHeld();
      return result;
    } finally {
      done = true;
    }
  };
  const nudge = async () => {
    let dx = 0;
    while (!done) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(200);
      if (done) break;
      // Re-read the center in case a new card joined above this one.
      // eslint-disable-next-line no-await-in-loop
      const { x, y } = await cardCenter();
      // Check before moving, so a nudge can't mask a hold that expired.
      // eslint-disable-next-line no-await-in-loop
      await expectStillHeld();
      if (done) break;
      dx = 1 - dx;
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.move(x + dx, y);
    }
  };
  try {
    const [result] = await Promise.all([update(), nudge()]);
    return result;
  } finally {
    done = true;
  }
};
