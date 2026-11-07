import { expect, type Locator, type Page } from '@playwright/test';

/** The widest window the app lays out as a phone (src/app/lib/hooks/useScreenSize.ts). */
const PHONE_MAX_WIDTH = 750;

/** Whether the page is as narrow as a phone, whose room header leaves its actions to the room menu. */
export const isPhoneLayout = (page: Page): boolean =>
  (page.viewportSize()?.width ?? Infinity) <= PHONE_MAX_WIDTH;

/** The open room's header, the banner with the room's name. */
export const roomHeader = (page: Page): Locator =>
  page.getByRole('banner').filter({ has: page.locator('h1') });

/** The room header's More Options button, which opens the room menu. */
export const roomMoreOptions = (page: Page): Locator =>
  roomHeader(page).getByRole('button', { name: 'More Options', exact: true });

/**
 * Opens the room's pinned messages: the header's Pinned Messages button, or on a phone the room
 * menu's entry. Returns the control focus belongs on after the list closes.
 */
export const openRoomPins = async (page: Page): Promise<Locator> => {
  if (!isPhoneLayout(page)) {
    const button = page.getByRole('button', { name: 'Pinned Messages', exact: true });
    await button.click();
    return button;
  }
  await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
  await roomMoreOptions(page).click();
  await page.getByRole('menuitem', { name: 'Pinned Messages', exact: true }).click();
  return roomMoreOptions(page);
};
