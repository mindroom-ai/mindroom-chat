import { expect, type Page } from '@playwright/test';

/**
 * On a phone, a section's own page (Home, where signing in lands) has the navigation drawer out
 * over the page, and what floats over the page, such as the new version notice, waits under it.
 * Puts the drawer away with Escape and waits until it has gone; wider screens have none.
 */
export const putPhoneDrawerAway = async (page: Page): Promise<void> => {
  if ((page.viewportSize()?.width ?? Infinity) > 750) return;
  const drawer = page.locator('#phone-nav-drawer');
  await expect(drawer, 'the drawer is out on the section page').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer, 'Escape puts the drawer away').toBeHidden();
};
