import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';

/**
 * CINNY-133 live verification: the invite autocomplete menu portals past host
 * clipping on every InviteUserPrompt host surface, and CINNY-132 ranking
 * surfaces the intended agent for its short name.
 *
 * Requires local fixtures (see FORK_CHANGES.md CINNY-133): users
 * mindroom_{mind,sarro,...} with display names Mind/Sarro/... plus a
 * "Portal Test Room" and a "Portal Test Space" with "Space Child Room",
 * all owned by the E2E user.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const SHOT_DIR = 'ui-audit/cinny133';

const ROOM_NAME = 'Portal Test Room';
const SPACE_NAME = 'Portal Test Space';
const SPACE_ID = process.env.E2E_PORTAL_SPACE_ID ?? '!ouDcQZnrnLBwRvjdsv:localhost';
const CHILD_NAME = 'Space Child Room';

const inviteInput = (page: Page) => page.locator('[name="userIdInput"]');
const inviteMenu = (page: Page) => page.locator('#invite-autocomplete-listbox');
const inviteForm = (page: Page) => page.locator('form:has([name="userIdInput"])');

async function verifyPortaledInviteMenu(page: Page, surface: string) {
  const field = inviteInput(page);
  await expect(field).toBeVisible({ timeout: 15_000 });

  await field.fill('mind');
  const menu = inviteMenu(page);
  await expect(menu).toBeVisible({ timeout: 15_000 });

  // CINNY-132: the agent whose short name is the query ranks first.
  const firstOption = page.locator('[role="option"]').first();
  await expect(firstOption).toHaveAttribute('aria-label', /^Mind, @mindroom_mind:/);

  // CINNY-133: the menu extends below the dialog content (the old clipping
  // boundary) while staying inside the viewport.
  const menuBox = await menu.boundingBox();
  const formBox = await inviteForm(page).boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox, 'menu bounding box').not.toBeNull();
  expect(formBox, 'form bounding box').not.toBeNull();
  expect(menuBox!.y + menuBox!.height).toBeGreaterThan(formBox!.y + formBox!.height);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport!.height + 1);

  await page.screenshot({ path: `${SHOT_DIR}/${surface}.png` });

  // Clicking a portaled option commits it without closing the dialog.
  await firstOption.click();
  await expect(field).toHaveValue(/^@mindroom_mind:/);
  await expect(inviteForm(page)).toBeVisible();
  await expect(menu).toBeHidden();

  // Escape closes only the menu; the dialog survives. (Escape never closes
  // the dialog while focus is in the input - pre-existing stopPropagation
  // behavior for editable elements.)
  await field.fill('sarro');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(inviteForm(page)).toBeVisible();

  // A backdrop click dismisses the dialog itself.
  await page.mouse.click(viewport!.width - 8, viewport!.height - 8);
  await expect(inviteForm(page)).toBeHidden();
}

test.describe('CINNY-133 invite menu portal', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('menu escapes host clipping on each invite surface', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();

    await loginWithPassword(page, { homeserver, username, password });

    const roomLink = page.locator(`a[href^="/home/"]:has-text("${ROOM_NAME}")`).first();
    await expect(roomLink).toBeVisible({ timeout: 30_000 });

    await test.step('room-nav-item context menu', async () => {
      await roomLink.click({ button: 'right' });
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'room-nav-item');
      await page.keyboard.press('Escape');
    });

    await test.step('members drawer invite entry', async () => {
      await roomLink.click();
      const drawerInvite = page.locator('[aria-label="Invite people"]');
      await expect(drawerInvite).toBeVisible({ timeout: 30_000 });
      await drawerInvite.click();
      await verifyPortaledInviteMenu(page, 'members-drawer');
    });

    await test.step('mindroom room header menu', async () => {
      // The vertical-dots "More Options" trigger is the last room-header button.
      const roomHeader = page.locator(`header:has-text("${ROOM_NAME}")`).first();
      await roomHeader.locator('button').last().click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'mindroom-room-header');
      await page.keyboard.press('Escape');
    });

    await test.step('space tabs context menu', async () => {
      const spaceTab = page.locator(`button[data-id="${SPACE_ID}"]`).first();
      await expect(spaceTab).toBeVisible({ timeout: 30_000 });
      await spaceTab.click({ button: 'right' });
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'space-tabs');
      await page.keyboard.press('Escape');
    });

    await test.step('space page panel menu', async () => {
      const spaceTab = page.locator(`button[data-id="${SPACE_ID}"]`).first();
      await spaceTab.click();
      const panelHeader = page.locator(`header:has-text("${SPACE_NAME}")`).last();
      await expect(panelHeader).toBeVisible({ timeout: 30_000 });
      await panelHeader.locator('button').last().click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'space-page-menu');
      await page.keyboard.press('Escape');
    });

    await test.step('lobby header menu', async () => {
      // The lobby's own header carries no text, unlike the space panel and
      // members drawer headers.
      const lobbyHeader = page
        .locator('header')
        .filter({ hasNotText: SPACE_NAME })
        .filter({ hasNotText: 'Members' })
        .last();
      await lobbyHeader.locator('button').last().click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'lobby-header');
      await page.keyboard.press('Escape');
    });

    await test.step('hierarchy item menu', async () => {
      const childRow = page.getByText(CHILD_NAME).first();
      await expect(childRow).toBeVisible({ timeout: 30_000 });
      await childRow.hover();
      const rowOptions = childRow
        .locator('xpath=ancestor::*[.//button[@aria-pressed]][1]//button[@aria-pressed]')
        .last();
      await rowOptions.click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyPortaledInviteMenu(page, 'hierarchy-item');
      await page.keyboard.press('Escape');
    });
  });
});
