import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  loginToMatrix,
  matrixFetch,
  setAccountData,
  type MatrixSession,
} from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import { defined } from '../../src/test/utils/defined';

// Spaces against the disposable homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh):
// creating a space and filling it from the lobby, its hierarchy as another member sees it,
// joining from a link, invites, and the rail's order. Each run registers its own accounts, so the
// lobby and the rail hold only what the run made.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const SERVER_NAME = 'matrix.localhost';
const PASSWORD = 'spaces-spec-password';
const RUN = Date.now().toString(36);

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `f6_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

const signIn = (page: Page, username: string) =>
  loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });

const createPublicRoom = (accessToken: string, name: string, space = false) =>
  createRoom(HOMESERVER, accessToken, { name, preset: 'public_chat', space });

/** The rail's space buttons, top to bottom, by the room ID each carries. */
const railSpaceIds = (page: Page) =>
  page
    .getByRole('group', { name: 'Spaces' })
    .locator('[data-id]')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-id')));

const lobbyCard = (page: Page, name: string) =>
  page.locator('[data-lobby-entry]').filter({ has: page.getByText(name, { exact: true }) });

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a space is created from the rail and filled from its lobby', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const owner = await registerAndLogin('owner');
  const compostId = await createRoom(HOMESERVER, owner.accessToken, { name: 'Compost' });
  // The rail's Create Space button is off until the account turns it on in Settings > Sidebar.
  await setAccountData(HOMESERVER, owner.accessToken, owner.userId, 'io.mindroom.settings', {
    showCreateSpaceInSidebar: true,
  });
  await signIn(page, owner.username);

  // The rail's Create Space button opens the dialog; a new space opens on its lobby.
  await page.getByRole('button', { name: 'Create Space' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Create Space' });
  await createDialog.getByRole('textbox', { name: 'Name' }).fill('Garden club');
  await createDialog.getByRole('textbox', { name: 'Topic (Optional)' }).fill('Plots and seeds');
  await createDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(createDialog).toBeHidden();
  await expect(page).toHaveURL(/\/lobby\/?$/, { timeout: 30_000 });
  const hero = page.getByRole('heading', { name: /Garden club/ }).last();
  await expect(hero).toBeVisible();
  await expect(page.getByText('No Rooms', { exact: true })).toBeVisible();
  const spaceId = decodeURIComponent(
    defined(new URL(page.url()).pathname.split('/')[1], 'a space ID in the URL')
  );
  expect(spaceId.startsWith('!')).toBe(true);
  const railTile = page.getByRole('group', { name: 'Spaces' }).locator(`[data-id="${spaceId}"]`);
  await expect(railTile).toBeVisible();
  // Without a picture the rail shows the first two characters of the space's name; the button
  // itself is named by the whole name.
  await expect(railTile.getByText('Ga', { exact: true })).toBeVisible();
  await expect(railTile).toHaveAccessibleName('Garden club');
  await page.screenshot({ path: testInfo.outputPath('lobby-empty.png') });

  // Add Room, Chat Room: the new room opens inside the space.
  await page.getByRole('button', { name: 'Add Room' }).first().click();
  await page.getByRole('menuitem', { name: 'Chat Room' }).click();
  const roomDialog = page.getByRole('dialog', { name: 'Create Room' });
  await roomDialog.locator('input[name="nameInput"]').fill('Seedlings');
  await roomDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(roomDialog).toBeHidden();
  await expect(page).toHaveURL(
    new RegExp(`/${encodeURIComponent(spaceId).replace(/[.!]/g, '\\$&')}/`)
  );
  const nav = page.getByTestId('resizable-page-nav');
  await expect(nav.getByRole('link', { name: 'Seedlings', exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // Add Room, Existing Room: pick one of the user's rooms.
  await nav.getByRole('link', { name: 'Lobby', exact: true }).click();
  await expect(lobbyCard(page, 'Seedlings')).toBeVisible();
  await page.getByRole('button', { name: 'Add Room' }).first().click();
  await page.getByRole('menuitem', { name: 'Existing Room' }).click();
  const picker = page.getByRole('dialog', { name: 'Add Existing' });
  await expect(picker.getByText('Seedlings', { exact: true })).toHaveCount(0);
  await picker.getByRole('textbox', { name: 'Search' }).fill('comp');
  await picker.getByRole('checkbox', { name: 'Compost' }).click();
  await expect(picker.getByText('Apply when ready. (1 Selected)')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('add-existing.png') });
  await picker.getByRole('button', { name: 'Apply Changes' }).click();
  await expect(picker).toBeHidden();
  await expect(lobbyCard(page, 'Compost')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Compost', exact: true })).toBeVisible();

  // Add Space, New Space: a subspace heading appears in the lobby.
  await page.getByRole('button', { name: 'Add Space' }).first().click();
  await page.getByRole('menuitem', { name: 'New Space' }).click();
  const subspaceDialog = page.getByRole('dialog', { name: 'New Space' });
  await subspaceDialog.getByRole('textbox', { name: 'Name' }).fill('Orchard');
  await subspaceDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(subspaceDialog).toBeHidden();
  await expect(lobbyCard(page, 'Orchard')).toBeVisible({ timeout: 30_000 });

  // A joined subspace can be pinned to the rail from its menu, and unpinned there again.
  await lobbyCard(page, 'Orchard').getByRole('button', { name: 'More Options' }).click();
  await page.getByRole('menuitem', { name: 'Pin to Sidebar' }).click();
  const rail = page.getByRole('group', { name: 'Spaces' });
  await expect(rail.locator('button[data-id]')).toHaveCount(2);
  await rail.locator('button[data-id]').last().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin' }).click();
  await expect(rail.locator('button[data-id]')).toHaveCount(1);

  // A room's menu marks it suggested, then takes it out of the space.
  const compost = lobbyCard(page, 'Compost');
  await compost.getByRole('button', { name: 'More Options' }).click();
  await page.getByRole('menuitem', { name: 'Set Suggested' }).click();
  await expect(compost.getByText('Suggested', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('lobby-filled.png') });
  await compost.getByRole('button', { name: 'More Options' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(lobbyCard(page, 'Compost')).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Compost', exact: true })).toHaveCount(0);
  const children = await matrixFetch<{ content: Record<string, unknown> }[]>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(spaceId)}/state`,
    { accessToken: owner.accessToken }
  );
  const compostLink = (
    children as unknown as { type: string; state_key: string; content: object }[]
  ).find((event) => event.type === 'm.space.child' && event.state_key === compostId);
  expect(compostLink?.content).toEqual({});
});

test('a member opens a shared space from a link and joins its rooms from the lobby', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const owner = await registerAndLogin('host');
  const guest = await registerAndLogin('guest');
  const spaceId = await createPublicRoom(owner.accessToken, 'Book circle', true);
  const roomId = await createPublicRoom(owner.accessToken, 'Reading list');
  const subspaceId = await createPublicRoom(owner.accessToken, 'Poetry corner', true);
  const poemsId = await createPublicRoom(owner.accessToken, 'Haiku');
  await addRoomToSpace(HOMESERVER, owner.accessToken, spaceId, roomId);
  await addRoomToSpace(HOMESERVER, owner.accessToken, spaceId, subspaceId);
  await addRoomToSpace(HOMESERVER, owner.accessToken, subspaceId, poemsId);

  await signIn(page, guest.username);
  await page.goto(`/${encodeURIComponent(spaceId)}/?via=${SERVER_NAME}`);
  await expect(page.getByText('Book circle', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({ path: testInfo.outputPath('join-from-link.png') });
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page).toHaveURL(/\/lobby\/?$/, { timeout: 30_000 });

  // Rooms the guest is not in come from the server's hierarchy, nested subspaces included.
  const reading = lobbyCard(page, 'Reading list');
  await expect(reading.getByRole('button', { name: 'Join', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(lobbyCard(page, 'Poetry corner')).toBeVisible();
  await expect(lobbyCard(page, 'Haiku')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('lobby-hierarchy.png') });
  await reading.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(reading.getByRole('button', { name: 'Open Room' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole('group', { name: 'Spaces' }).locator(`[data-id="${spaceId}"]`)
  ).toBeVisible();
});

test('an invited member accepts a space invite and lands in its lobby', async ({ page }) => {
  test.setTimeout(240_000);
  const owner = await registerAndLogin('inviter');
  const guest = await registerAndLogin('invitee');
  const spaceId = await createRoom(HOMESERVER, owner.accessToken, {
    name: 'Night owls',
    invite: [guest.userId],
    space: true,
  });

  await signIn(page, guest.username);
  await page.goto('/activity/invites/');
  const invite = page.locator('[data-invite-room-id]').filter({ hasText: 'Night owls' });
  const card = (await invite.count()) > 0 ? invite : page.getByText('Night owls').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Accept', exact: true }).first().click();
  await expect(
    page.getByRole('group', { name: 'Spaces' }).locator(`[data-id="${spaceId}"]`)
  ).toBeVisible({ timeout: 30_000 });
});

/** Drags `from` with the mouse onto the upper or lower edge, or the middle, of `to`. */
const dragOnto = async (
  page: Page,
  from: Locator,
  to: Locator,
  where: 'above' | 'middle' | 'below'
) => {
  const start = (await from.boundingBox())!;
  const target = (await to.boundingBox())!;
  const share = { above: 0.15, middle: 0.5, below: 0.85 }[where];
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 12, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * share, {
    steps: 12,
  });
  await page.mouse.up();
};

test('the rail lists spaces in their saved order and reorders them by drag and drop', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const owner = await registerAndLogin('order');
  const first = await createRoom(HOMESERVER, owner.accessToken, { name: 'Alpha', space: true });
  const second = await createRoom(HOMESERVER, owner.accessToken, { name: 'Bravo', space: true });
  const third = await createRoom(HOMESERVER, owner.accessToken, { name: 'Charlie', space: true });
  await setAccountData(HOMESERVER, owner.accessToken, owner.userId, 'io.mindroom.spaces', {
    sidebar: [third, first],
  });

  await signIn(page, owner.username);
  await expect.poll(() => railSpaceIds(page), { timeout: 30_000 }).toEqual([third, first, second]);
  const rail = page.getByRole('group', { name: 'Spaces' });
  const button = (spaceId: string) => rail.locator(`button[data-id="${spaceId}"]`);

  // A plain move stays on this device: the saved order does not change.
  await dragOnto(page, button(second), button(third), 'above');
  await expect.poll(() => railSpaceIds(page)).toEqual([second, third, first]);

  // Ctrl (Command on a Mac) with Shift and an arrow key moves the focused space.
  await button(first).focus();
  await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
  await expect.poll(() => railSpaceIds(page)).toEqual([second, first, third]);

  // Dropping a space on another groups both in a folder, which every device sees.
  await dragOnto(page, button(third), button(second), 'middle');
  const folder = rail.locator('button[data-folder-id]');
  await expect(folder).toBeVisible();
  await expect
    .poll(async () => {
      const content = await matrixFetch<{ sidebar?: unknown[] }>(
        HOMESERVER,
        `/user/${encodeURIComponent(owner.userId)}/account_data/io.mindroom.spaces`,
        { accessToken: owner.accessToken }
      );
      return content.sidebar?.find((entry) => typeof entry === 'object');
    })
    .toMatchObject({ content: [second, third] });
  await page.screenshot({ path: testInfo.outputPath('rail-folder-closed.png') });
  await folder.click();
  await expect(button(second)).toBeVisible();
  await expect(button(third)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('rail-folder-open.png') });
});
