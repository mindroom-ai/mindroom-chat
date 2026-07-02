import type { Page } from '@playwright/test';

/**
 * Clicks "Load Older Messages" until the thread's history is fully loaded and
 * returns how many pages were requested.
 *
 * The chip's label flips to "Loading..." while a page is in flight, so the
 * loop must keep waiting through that state instead of treating the missing
 * "Load Older Messages" label as completion — and completion itself is only
 * trusted after two consecutive checks with neither label present (the flip
 * between the two labels is not atomic).
 */
export const loadAllOlderThreadMessages = async (page: Page): Promise<number> => {
  let clicks = 0;
  for (let i = 0; i < 60; i += 1) {
    const loadOlder = page.getByRole('button', { name: 'Load Older Messages' });
    // eslint-disable-next-line no-await-in-loop
    if ((await loadOlder.count()) > 0) {
      clicks += 1;
      // eslint-disable-next-line no-await-in-loop
      await loadOlder.first().click();
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(400);
      continue;
    }
    const loading = page.getByRole('button', { name: 'Loading...' });
    // eslint-disable-next-line no-await-in-loop
    if ((await loading.count()) > 0) {
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(400);
      continue;
    }
    // Neither label present for two consecutive checks -> fully loaded.
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
    // eslint-disable-next-line no-await-in-loop
    if ((await loadOlder.count()) === 0 && (await loading.count()) === 0) return clicks;
  }
  return clicks;
};
