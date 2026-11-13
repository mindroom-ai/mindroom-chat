import { devices, expect, test, type Page } from '@playwright/test';
import { activeAccountButton, loginWithPassword } from '../helpers/auth';
import { buildLoginPath } from '../env';
import { createPrivateRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { expectRoomCompact, roomViewSwitch } from '../helpers/roomViewSwitch';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Jump to Time in the room menu: the room's beginning opens the Full view at the room's first
// events, far older than the sync window, and a server without `/timestamp_to_event` gets a
// message instead. On a phone it also lands in a room whose beginning the client has not
// loaded, after a long draft was left in another room. Runs against the disposable homeserver
// of `just hs-up` (or a slot of scripts/e2e-slot.sh).

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const PASSWORD = 'jump-to-time-password';
const RUN = Date.now().toString(36);
const FIRST_NOTE = 'First note in the logbook';
/** More room messages than one /sync brings per room (STARTUP_SYNC_TIMELINE_LIMIT is 20). */
const LATER_NOTES = 40;

const register = async (username: string): Promise<string> => {
  const body = await matrixFetch<{ access_token: string }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  return body.access_token;
};

const signIn = async (page: Page, username: string) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER, {
    timeout: 60_000,
  });
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(activeAccountButton(page)).toBeVisible({
    timeout: 120_000,
  });
};

const openJumpToTime = async (page: Page) => {
  await page.getByRole('button', { name: 'More Options' }).click();
  await page.getByRole('menuitem', { name: 'Jump to Time' }).click();
  const dialog = page.getByRole('dialog', { name: 'Jump to Time' });
  await expect(dialog).toBeVisible();
  return dialog;
};

test('Jump to Time opens the Full view at the beginning, or says the server cannot', async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );

  const username = `jump_time_${RUN}`;
  const token = await register(username);
  const roomId = await createPrivateRoom(HOMESERVER, token, {
    name: 'Ship Logbook',
    topic: 'Notes by the hour',
  });
  const send = (body: string) =>
    sendRoomMessage(HOMESERVER, token, roomId, { msgtype: 'm.text', body }, 'jump-to-time');
  await send(FIRST_NOTE);
  for (let index = 0; index < LATER_NOTES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(`Later note ${index}`);
  }

  await signIn(page, username);
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const viewSwitch = roomViewSwitch(page);
  await expect(viewSwitch).toBeVisible({ timeout: 60_000 });
  // Start in Compact, so the jump has to bring up the Full view.
  if ((await viewSwitch.getAttribute('aria-pressed')) !== 'true') await viewSwitch.click();
  await expect(viewSwitch).toHaveAttribute('aria-pressed', 'true');

  // A server without the endpoint: the dialog stays and says so.
  await page.route('**/timestamp_to_event**', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ errcode: 'M_UNRECOGNIZED', error: 'Unrecognized request' }),
    })
  );
  let dialog = await openJumpToTime(page);
  await dialog.getByRole('button', { name: 'Open Timeline' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'This server cannot look up messages by time.'
  );
  await page.screenshot({ path: testInfo.outputPath('jump-unsupported.png') });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await page.unroute('**/timestamp_to_event**');

  // The beginning: the room's creation, long before the newest notes.
  dialog = await openJumpToTime(page);
  await dialog.getByRole('button', { name: 'Beginning' }).click();
  await expect(dialog.getByRole('button', { name: 'Beginning' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(dialog.getByRole('combobox', { name: 'Year' })).toHaveValue(
    String(new Date().getFullYear())
  );
  await page.screenshot({ path: testInfo.outputPath('jump-dialog.png') });
  const lookup = page.waitForResponse((response) => response.url().includes('/timestamp_to_event'));
  await dialog.getByRole('button', { name: 'Open Timeline' }).click();
  const { event_id: eventId } = (await (await lookup).json()) as { event_id: string };
  await expect(dialog).toBeHidden();

  await expect(page).toHaveURL(new RegExp(encodeURIComponent(eventId).replace(/\$/g, '\\$')));
  await expect(viewSwitch).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(FIRST_NOTE, { exact: true })).toBeInViewport({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath('jump-landed.png') });
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['Pixel 7'].userAgent,
  });

  /**
   * More notes than the client loads ahead (one /sync of 20 and one page of 200), so the room's
   * beginning comes from the server: alone, since the SDK asks `/context` for no neighbours.
   */
  const LONG_LOG_NOTES = 250;

  test('Jump to Time reaches the beginning of a room whose start is not loaded', async ({
    page,
  }, testInfo) => {
    test.setTimeout(360_000);
    test.skip(
      !(await disposableHomeserverIsUp()),
      `No homeserver at ${HOMESERVER}; run \`just hs-up\``
    );

    const username = `jump_time_phone_${RUN}`;
    const token = await register(username);
    const roomId = await createPrivateRoom(HOMESERVER, token, {
      name: 'Ship Logbook',
      topic: 'Notes by the hour',
    });
    const send = (body: string) =>
      sendRoomMessage(HOMESERVER, token, roomId, { msgtype: 'm.text', body }, 'jump-to-time');
    await send(FIRST_NOTE);
    for (let index = 0; index < LONG_LOG_NOTES; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await send(`Later note ${index}: wind ${10 + (index % 7)} knots`);
    }

    await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
    await page.goto(`/home/${encodeURIComponent(roomId)}/`);
    const newest = page.getByText(`Later note ${LONG_LOG_NOTES - 1}:`, { exact: false });
    await expect(newest).toBeVisible({ timeout: 60_000 });

    const header = page.getByRole('banner').filter({ has: page.locator('h1') });
    await header.getByRole('button', { name: 'More Options' }).tap();
    await page.getByRole('menuitem', { name: 'Jump to Time' }).tap();
    const dialog = page.getByRole('dialog', { name: 'Jump to Time' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Beginning' }).tap();
    const lookup = page.waitForResponse((response) =>
      response.url().includes('/timestamp_to_event')
    );
    await dialog.getByRole('button', { name: 'Open Timeline' }).tap();
    const { event_id: eventId } = (await (await lookup).json()) as { event_id: string };
    await expect(dialog).toBeHidden();

    await expect(page).toHaveURL(new RegExp(encodeURIComponent(eventId).replace(/\$/g, '\\$')));
    await expectRoomCompact(page, false);
    const first = page.getByText(FIRST_NOTE, { exact: true });
    await expect(first).toBeInViewport({ timeout: 60_000 });
    // It stays: the history loaded after it must not hand the view to the newest rows.
    await page.waitForTimeout(1_500);
    await expect(first).toBeInViewport({ timeout: 1_000 });
    await expect(newest).not.toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('jump-phone-landed.png') });
  });
});
