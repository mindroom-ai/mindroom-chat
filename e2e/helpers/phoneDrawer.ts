import type { Page } from '@playwright/test';

/**
 * On a phone, a section's own page (Home, where signing in lands) has the navigation drawer out
 * over the page, and what floats over the page, such as the new version notice, waits under it.
 * Escape puts the drawer away; wider screens have none.
 */
export const putPhoneDrawerAway = async (page: Page): Promise<void> => {
  if ((page.viewportSize()?.width ?? Infinity) <= 750) await page.keyboard.press('Escape');
};
