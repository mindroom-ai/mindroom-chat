import { expect, type Page } from '@playwright/test';

/**
 * Opens the sidebar's THREADS category the way a person does, by its header. It starts collapsed
 * on a device until the person opens it, and then stays open there, reloads included.
 */
export const openThreadsCategory = async (page: Page): Promise<void> => {
  const toggle = page.locator('button[data-category-id="mindroom|threads"]');
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
};
