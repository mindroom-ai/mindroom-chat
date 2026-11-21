import { expect, type Locator, type Page } from '@playwright/test';

/** The widest window the app lays out as a phone (src/app/lib/hooks/useScreenSize.ts). */
const PHONE_MAX_WIDTH = 750;

/** Whether the page is as narrow as a phone, whose room header can overflow actions into the menu. */
export const isPhoneLayout = (page: Page): boolean =>
  (page.viewportSize()?.width ?? Infinity) <= PHONE_MAX_WIDTH;

/** The open room's header, the banner with the room's name. */
export const roomHeader = (page: Page): Locator =>
  page.getByRole('banner').filter({ has: page.locator('h1') });

/** The room header's More Options button, which opens the room menu. */
export const roomMoreOptions = (page: Page): Locator =>
  roomHeader(page).getByRole('button', { name: 'More Options', exact: true });

/**
 * Opens the room's pinned messages from the row or the overflow menu. Returns the opener to
 * which focus belongs after the list closes.
 */
export const openRoomPins = async (page: Page): Promise<Locator> => {
  const button = roomHeader(page).getByRole('button', { name: 'Pinned Messages', exact: true });
  if (!isPhoneLayout(page)) {
    await button.click();
    return button;
  }

  const more = roomMoreOptions(page);
  const entry = page.getByRole('menuitem', { name: 'Pinned Messages', exact: true });
  await expect(more).toBeVisible({ timeout: 60_000 });
  if (!(await button.isVisible()) && (await more.getAttribute('aria-expanded')) !== 'true') {
    await more.click();
  }
  // The pins may sync after the room menu opens, and appear in either place.
  await expect(button.or(entry).first()).toBeVisible({ timeout: 60_000 });
  if (await button.isVisible()) {
    if ((await more.getAttribute('aria-expanded')) === 'true') {
      await page.keyboard.press('Escape');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
    }
    await button.click();
    return button;
  }
  await entry.click();
  return more;
};
