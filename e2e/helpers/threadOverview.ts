import { expect, type Page } from '@playwright/test';

export const getThreadOverviewSortButton = (page: Page) =>
  page.locator('[data-room-thread-overview="true"] button[data-sort-by]');

/**
 * Turns off the thread filter bar's resolved filter, simple or advanced, so resolved threads show:
 * a Compact room opens with them hidden.
 */
export const showResolvedThreads = async (page: Page) => {
  const overview = page.locator('[data-room-thread-overview="true"]');
  const simple = overview.locator('[data-simple-unresolved-toggle]');
  const advanced = overview.locator('[data-filter-key="resolved"]');
  await expect(async () => {
    if ((await simple.count()) > 0) {
      if ((await simple.getAttribute('aria-pressed')) === 'true') await simple.click();
      await expect(simple).toHaveAttribute('aria-pressed', 'false', { timeout: 2_000 });
      return;
    }
    if ((await advanced.getAttribute('data-filter-state', { timeout: 2_000 })) !== 'any') {
      await advanced.click();
    }
    await expect(advanced).toHaveAttribute('data-filter-state', 'any', { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
};
