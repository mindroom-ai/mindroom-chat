import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { addRoomToSpace, sendRoomMessage } from '../helpers/matrix';

// Home groups rooms outside spaces under Rooms first, then lists joined spaces in rail order with
// nested sub-spaces directly below their parent. Runs against the disposable homeserver of
// `just hs-up` (or a slot of scripts/e2e-slot.sh). Set HOME_SPACE_SECTIONS_SHOTS=<directory> to
// capture mixed.png, collapsed.png, and all-spaced.png.
const PASSWORD = 'home-space-sections-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.HOME_SPACE_SECTIONS_SHOTS;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const homeNav = (page: Page) => page.getByRole('navigation', { name: 'Home', exact: true });

/** Rendered room rows inside a page navigation, top to bottom. */
const navRowOrder = (page: Page, navName: string) =>
  page
    .getByRole('navigation', { name: navName, exact: true })
    .locator('[data-room-id]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-room-id') ?? ''));

/** Rendered section category buttons inside Home, top to bottom. */
const homeSectionLabels = (page: Page) =>
  homeNav(page)
    .locator('button[data-category-id^="home|"]')
    .evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim() ?? ''));

const captureShot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test('groups Home rooms by rail-ordered spaces, persists Home collapse, supports section menus, and handles all-spaced cleanly', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const account = await registerDisposableUser(`hss_${RUN}`, PASSWORD);

  const personalNotes = await createRoom(HOMESERVER, account.accessToken, {
    name: 'Personal Notes',
  });
  const work = await createRoom(HOMESERVER, account.accessToken, { name: 'Work', space: true });
  const designTeam = await createRoom(HOMESERVER, account.accessToken, {
    name: 'Design Team',
    space: true,
  });
  const gardenClub = await createRoom(HOMESERVER, account.accessToken, {
    name: 'Garden Club',
    space: true,
  });
  const weeklyPlanning = await createRoom(HOMESERVER, account.accessToken, {
    name: 'Weekly Planning',
  });
  const sketches = await createRoom(HOMESERVER, account.accessToken, { name: 'Sketches' });
  const plantCare = await createRoom(HOMESERVER, account.accessToken, { name: 'Plant Care' });

  await addRoomToSpace(HOMESERVER, account.accessToken, work, weeklyPlanning);
  await addRoomToSpace(HOMESERVER, account.accessToken, work, designTeam);
  await addRoomToSpace(HOMESERVER, account.accessToken, designTeam, sketches);
  await addRoomToSpace(HOMESERVER, account.accessToken, gardenClub, plantCare);

  await sendRoomMessage(HOMESERVER, account.accessToken, weeklyPlanning, {
    msgtype: 'm.text',
    body: 'Agenda ready',
  });
  await sendRoomMessage(HOMESERVER, account.accessToken, sketches, {
    msgtype: 'm.text',
    body: 'Wireframes uploaded',
  });

  await loginWithPassword(page, { homeserver: HOMESERVER, ...account });

  // 1. Unspaced Rooms first, then rail-ordered spaces with sub-space directly under its parent.
  await expect
    .poll(() => homeSectionLabels(page), { timeout: 30_000 })
    .toEqual(['Rooms', 'Work', 'Design Team', 'Garden Club']);
  await expect
    .poll(() => navRowOrder(page, 'Home'), { timeout: 30_000 })
    .toEqual([personalNotes, weeklyPlanning, sketches, plantCare]);
  await captureShot(page, 'mixed');

  // 2. Collapse Work on Home, persist across reload, and keep Work space's own view expanded.
  const workCategory = homeNav(page).locator(`button[data-category-id="home|space|${work}"]`);
  await workCategory.click();
  await expect.poll(() => navRowOrder(page, 'Home')).toEqual([personalNotes, sketches, plantCare]);
  await captureShot(page, 'collapsed');

  await page.reload();
  await expect
    .poll(() => navRowOrder(page, 'Home'), { timeout: 30_000 })
    .toEqual([personalNotes, sketches, plantCare]);

  // Viewing Work directly from the rail still shows Weekly Planning expanded.
  const rail = page.getByRole('group', { name: 'Spaces' });
  await rail.locator(`button[data-id="${work}"]`).click();
  await expect
    .poll(() => navRowOrder(page, 'Work'), { timeout: 30_000 })
    .toEqual([weeklyPlanning, sketches]);

  // Return to Home and re-expand Work.
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('button', { name: 'Home', exact: true })
    .click();
  await expect.poll(() => navRowOrder(page, 'Home')).toEqual([personalNotes, sketches, plantCare]);
  await homeNav(page).locator(`button[data-category-id="home|space|${work}"]`).click();
  await expect
    .poll(() => navRowOrder(page, 'Home'))
    .toEqual([personalNotes, weeklyPlanning, sketches, plantCare]);

  // 3. Clicking a spaced room on Home stays under /home/<room> and highlights it; Message Search opens /home/search.
  const weeklyRow = homeNav(page).locator(`[data-room-id="${weeklyPlanning}"]`);
  await weeklyRow.click();
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).pathname))
    .toBe(`/home/${weeklyPlanning}`);
  await expect(weeklyRow.locator('a[aria-current="page"]')).toBeVisible();

  await weeklyRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Message Search', exact: true }).click();
  await expect(page).toHaveURL(/\/home\/search/);

  // 4. Home space section options menu: no Match space / Pin on top-level, WITH Space overview; Recent + times apply.
  await homeNav(page).getByRole('button', { name: 'Work', exact: true }).hover();
  await homeNav(page).getByRole('button', { name: 'Work options' }).click();
  await expect(page.getByRole('menuitemradio', { name: /Match space/ })).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', { name: /Pin to Sidebar|Unpin from Sidebar/ })
  ).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Space overview', exact: true })).toBeVisible();

  const showTimesToggle = page.getByRole('menuitemcheckbox', { name: 'Show activity times' });
  await showTimesToggle.click();
  await expect(showTimesToggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Recent activity' }).click();

  await page.mouse.move(0, 0);
  await expect(weeklyRow.locator('[data-room-activity-time]')).toBeVisible();
  await expect(
    homeNav(page).locator(`[data-room-id="${sketches}"] [data-room-activity-time]`)
  ).toBeVisible();

  // Sub-space menu DOES show Match space (Recent), Pin to Sidebar, and Space overview.
  await homeNav(page).getByRole('button', { name: 'Design Team', exact: true }).hover();
  await homeNav(page).getByRole('button', { name: 'Design Team options' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Match space (Recent)' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(page.getByRole('menuitem', { name: 'Pin to Sidebar', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Space overview', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // 5. Move Personal Notes into Garden Club: zero unspaced rooms hides Rooms heading and Home Sort, never shows No Rooms.
  await page.goto('/home');
  await expect(homeNav(page)).toBeVisible({ timeout: 30_000 });
  await addRoomToSpace(HOMESERVER, account.accessToken, gardenClub, personalNotes);
  await expect
    .poll(() => homeSectionLabels(page), { timeout: 30_000 })
    .toEqual(['Work', 'Design Team', 'Garden Club']);
  await expect(homeNav(page).getByTestId('room-nav-category')).toHaveCount(0);
  await expect(homeNav(page).getByRole('button', { name: 'Sort rooms' })).toHaveCount(0);
  await expect(homeNav(page).getByText('No Rooms')).toHaveCount(0);
  await expect
    .poll(() => navRowOrder(page, 'Home'))
    .toEqual([weeklyPlanning, sketches, personalNotes, plantCare]);
  await captureShot(page, 'all-spaced');
});
