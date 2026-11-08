import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { matrixFetch } from '../helpers/matrix';

// The sidebar's Join a Room dialog: one search field over the public rooms of the user's own
// server, each with Join (Open once joined), and a pasted address on top instead of the list.
// Set JOIN_ROOM_SHOTS=<directory> to also save it in dark and light themes and at a phone's width.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const SERVER_NAME = 'matrix.localhost';
const PASSWORD = 'join-room-dialog-spec-password';
const SHOTS = process.env.JOIN_ROOM_SHOTS;

type Account = { username: string; userId: string; accessToken: string };

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

const register = async (prefix: string, run: string): Promise<Account> => {
  const username = `${prefix}_${run}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { username, userId: body.user_id, accessToken: body.access_token };
};

type PublicRoom = { name: string; topic: string; alias: string; listed: boolean };

const createPublicRoom = async (owner: Account, room: PublicRoom): Promise<string> => {
  const body = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: owner.accessToken,
    body: JSON.stringify({
      preset: 'public_chat',
      visibility: room.listed ? 'public' : 'private',
      name: room.name,
      topic: room.topic,
      room_alias_name: room.alias,
    }),
  });
  return body.room_id;
};

/** Three rooms in the directory and one that only its address finds, owned by another person. */
const seed = async () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const owner = await register('join_owner', run);
  const viewer = await register('join_viewer', run);
  const inDirectory = (name: string, topic: string, alias: string): PublicRoom => ({
    name: `${name} ${run}`,
    topic,
    alias: `${alias}_${run}`,
    listed: true,
  });
  const listed: [PublicRoom, PublicRoom, PublicRoom] = [
    inDirectory('Garden Club', 'Seeds, soil and swaps', 'garden'),
    inDirectory('Night Owls', 'For late hours', 'owls'),
    inDirectory('Recipe Swap', 'Share what you cooked', 'recipes'),
  ];
  const unlisted: PublicRoom = {
    name: `Quiet Corner ${run}`,
    topic: 'Not in the directory',
    alias: `quiet_${run}`,
    listed: false,
  };
  for (const room of [...listed, unlisted]) await createPublicRoom(owner, room);
  return { viewer, listed, unlisted };
};

const openDialog = async (page: Page, viewer: Account): Promise<Locator> => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
  });
  await page.locator('[data-home-room-action="join"]').click();
  const dialog = page.getByRole('dialog', { name: 'Join a Room' });
  await expect(dialog).toBeVisible();
  return dialog;
};

const rowOf = (dialog: Locator, name: string) =>
  dialog.locator('[data-join-room]').filter({ hasText: name });

const joinedRoomIds = async (account: Account): Promise<string[]> =>
  (
    await matrixFetch<{ joined_rooms: string[] }>(HOMESERVER, '/joined_rooms', {
      accessToken: account.accessToken,
    })
  ).joined_rooms;

test.beforeAll(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('lists public rooms, searches them, joins one and offers a pasted address', async ({
  page,
}) => {
  test.slow();
  const { viewer, listed, unlisted } = await seed();
  await page.setViewportSize({ width: 1280, height: 800 });
  const dialog = await openDialog(page, viewer);

  // The field is a search, and no password manager takes it for a sign-in field.
  const field = dialog.getByRole('searchbox', { name: 'Search rooms or paste an address' });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('placeholder', 'Search rooms or paste an address');
  await expect(field).toHaveAttribute('autocomplete', 'off');
  await expect(field).toHaveAttribute('data-1p-ignore', /.*/);
  await expect(field).toHaveAttribute('data-lpignore', 'true');
  await expect(field).toHaveAttribute('data-form-type', 'other');

  // The three directory rooms are listed, each with Join; the unlisted one is not.
  await expect(dialog.getByText(`Public rooms on ${SERVER_NAME}`)).toBeVisible();
  for (const room of listed) {
    const row = rowOf(dialog, room.name);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(room.topic);
    await expect(row).toContainText('1 Member');
    await expect(row.getByRole('button', { name: 'Join' })).toBeVisible();
  }
  await expect(rowOf(dialog, unlisted.name)).toHaveCount(0);

  // Arrow keys move from the field through the rows' buttons and back.
  await field.press('ArrowDown');
  await expect(dialog.getByRole('button', { name: 'Join' }).first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('button', { name: 'Join' }).nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(field).toBeFocused();

  // Searching narrows the list to the matching room.
  const [garden, owls, recipes] = listed;
  await field.fill(owls.name.toLowerCase());
  await expect(dialog.locator('[data-join-room]')).toHaveCount(1);
  await expect(rowOf(dialog, owls.name)).toBeVisible();
  await field.fill('no room is called this');
  await expect(dialog.getByText('No public rooms match your search.')).toBeVisible();
  await field.fill('');
  await expect(rowOf(dialog, recipes.name)).toBeVisible();

  // Join turns into Open on the row, and the server has the membership.
  const gardenRow = rowOf(dialog, garden.name);
  await gardenRow.getByRole('button', { name: 'Join' }).click();
  await expect(gardenRow.getByRole('button', { name: 'Open' })).toBeVisible({ timeout: 30_000 });
  await expect(gardenRow.getByRole('button', { name: 'Join' })).toHaveCount(0);
  const gardenId = await gardenRow.getAttribute('data-join-room');
  expect(await joinedRoomIds(viewer)).toContain(gardenId);
  await expect(rowOf(dialog, owls.name).getByRole('button', { name: 'Join' })).toBeVisible();

  // Right to left, Join sits at the row's left end, after the name.
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  const owlsRow = rowOf(dialog, owls.name);
  const joinBox = await owlsRow.getByRole('button', { name: 'Join' }).boundingBox();
  const nameBox = await owlsRow.getByText(owls.name).boundingBox();
  expect(joinBox && nameBox && joinBox.x + joinBox.width <= nameBox.x).toBe(true);
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'ltr'));

  // A pasted address of a room the directory does not list takes the list's place, with Join.
  const address = `#${unlisted.alias}:${SERVER_NAME}`;
  await field.fill(address);
  const addressRow = rowOf(dialog, unlisted.name);
  await expect(addressRow).toBeVisible({ timeout: 30_000 });
  await expect(dialog.locator('[data-join-room]')).toHaveCount(1);
  await expect(addressRow.getByRole('button', { name: 'Join' })).toBeVisible();
  // Enter in the field joins it.
  await field.press('Enter');
  await expect(addressRow.getByRole('button', { name: 'Open' })).toBeVisible({ timeout: 30_000 });

  // Escape closes the dialog, even with text in the field.
  await field.focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Open goes to a joined room and the Explore link to Explore', async ({ page }) => {
  test.slow();
  const { viewer, listed } = await seed();
  const [garden] = listed;
  await matrixFetch(HOMESERVER, `/join/${encodeURIComponent(`#${garden.alias}:${SERVER_NAME}`)}`, {
    method: 'POST',
    accessToken: viewer.accessToken,
    body: '{}',
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  let dialog = await openDialog(page, viewer);

  const gardenRow = rowOf(dialog, garden.name);
  await gardenRow.getByRole('button', { name: 'Open' }).click({ timeout: 30_000 });
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/home\/(!|%21)/);

  await page.locator('[data-home-room-action="join"]').click();
  dialog = page.getByRole('dialog', { name: 'Join a Room' });
  await dialog.getByRole('link', { name: 'Browse more on Explore' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/explore\//);
});

test('saves the dialog in dark and light themes and at a phone width', async ({ page }) => {
  test.skip(!SHOTS, 'Set JOIN_ROOM_SHOTS=<directory> to save the screenshots');
  test.slow();
  const { viewer, listed } = await seed();
  const [garden] = listed;
  await matrixFetch(HOMESERVER, `/join/${encodeURIComponent(`#${garden.alias}:${SERVER_NAME}`)}`, {
    method: 'POST',
    accessToken: viewer.accessToken,
    body: '{}',
  });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
  });

  const shoot = async (themeId: string, width: number, height: number, file: string) => {
    await page.setViewportSize({ width, height });
    await page.evaluate((id) => {
      const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
      localStorage.setItem(
        'settings',
        JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
      );
    }, themeId);
    await page.goto('/home/');
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
    await page.locator('[data-home-room-action="join"]').click();
    const dialog = page.getByRole('dialog', { name: 'Join a Room' });
    for (const room of listed) await expect(rowOf(dialog, room.name)).toBeVisible();
    // The sync pill can come back while the dialog opens; the picture waits for it to go.
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${SHOTS}/${file}` });
  };

  await shoot('dark-theme', 1280, 800, 'L20-join-dark.png');
  await shoot('light-theme', 1280, 800, 'L20-join-light.png');
  await shoot('dark-theme', 390, 844, 'L20-join-phone.png');
});
