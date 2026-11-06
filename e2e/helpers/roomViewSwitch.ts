import { expect, type Locator, type Page } from '@playwright/test';
import { isPhoneLayout, roomMoreOptions } from './roomMenu';

/**
 * The room header's Compact and Threads switch. `aria-pressed` is true while the room shows
 * the Compact view; a click moves to Compact from any other mode, and from Compact to Threads.
 * Direct chats between people have no switch. A phone's header has none either: its room menu
 * holds the switch as a menu checkbox (`aria-checked`); see `toggleRoomView` and
 * `expectRoomCompact`, which work on both.
 */
export const roomViewSwitch = (page: Page): Locator => page.locator('[data-room-view-switch]');

/**
 * The switch the room offers: the header's button, or on a phone the room menu's entry, which
 * this opens; `inMenu` says which, so a caller that only reads it can close the menu again.
 */
const reachSwitch = async (page: Page): Promise<{ control: Locator; inMenu: boolean }> => {
  if (!isPhoneLayout(page)) {
    await expect(roomViewSwitch(page)).toBeVisible({ timeout: 60_000 });
    return { control: roomViewSwitch(page), inMenu: false };
  }
  const entry = page.getByRole('menu').locator('[data-room-view-switch]');
  // A menu opened while the room is still loading may lack the switch: close it and try again.
  await expect(async () => {
    if ((await page.getByRole('menu').count()) > 0) await page.keyboard.press('Escape');
    await roomMoreOptions(page).click({ timeout: 5_000 });
    await expect(entry).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  return { control: entry, inMenu: true };
};

/** Whether the switch says the room shows Compact; a menu it opened for that closes again. */
const readCompact = async (page: Page): Promise<boolean> => {
  const { control, inMenu } = await reachSwitch(page);
  const value = await control.getAttribute(inMenu ? 'aria-checked' : 'aria-pressed');
  if (inMenu) {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  return value === 'true';
};

/** Flips the room between Compact and its full view with its switch, on any screen. */
export const toggleRoomView = async (page: Page): Promise<void> => {
  const { control } = await reachSwitch(page);
  await control.click();
};

/** Waits until the switch says the room shows Compact (`true`) or another view (`false`). */
export const expectRoomCompact = async (
  page: Page,
  compact: boolean,
  timeout = 30_000
): Promise<void> => {
  await expect
    .poll(() => readCompact(page), { message: `the room shows Compact: ${compact}`, timeout })
    .toBe(compact);
};

/** Puts the room in Compact (`true`) or its full view (`false`), on any screen. */
export const setRoomCompact = async (page: Page, compact: boolean): Promise<void> => {
  if ((await readCompact(page)) !== compact) await toggleRoomView(page);
  await expectRoomCompact(page, compact);
};

/** Leaves the Compact view if the room shows it, on any screen. */
export const leaveCompactView = (page: Page): Promise<void> => setRoomCompact(page, false);
