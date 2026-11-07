import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Two tabs of one browser with two accounts (P2-lane5-F001). The first tab shows a room only the
// first account is in; the second tab switches to the second account. The first tab follows the
// switch: it leaves the first account's room for the second account's own last page, as the tab
// that switched does, instead of showing the room's raw ID with only "Retry room info". Runs in
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against
// the disposable homeserver. TWO_TABS_ROOM_SHOTS=<directory> saves the first tab after the switch.
const PASSWORD = 'two-tabs-follow-room-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.TWO_TABS_ROOM_SHOTS;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const accountButton = (page: Page, user: DisposableUser) =>
  page.getByRole('button', { name: new RegExp(`^Open account menu for .*${user.username}`) });

const followsSwitchOutOfTheRoom = async (context: BrowserContext, browserName: string) => {
  const pageErrors: string[] = [];
  context.on('page', (page) => {
    page.on('pageerror', (error) => pageErrors.push(`${page.url()}: ${error.message}`));
  });
  const first = await registerDisposableUser(`ttfr_a_${browserName}_${RUN}`, PASSWORD);
  const second = await registerDisposableUser(`ttfr_b_${browserName}_${RUN}`, PASSWORD);
  const firstRoomName = `First desk room ${browserName} ${RUN}`;
  const secondRoomName = `Second desk room ${browserName} ${RUN}`;
  const firstRoom = await createRoom(HOMESERVER, first.accessToken, { name: firstRoomName });
  await createRoom(HOMESERVER, second.accessToken, { name: secondRoomName });

  const one = await context.newPage();
  await loginWithPassword(one, { homeserver: HOMESERVER, ...second });
  await expect(one.getByText(secondRoomName, { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
  await chooseFromAccountMenu(one, 'Add Account');
  await loginWithPassword(one, { homeserver: HOMESERVER, ...first, addAccount: true });
  await expect(accountButton(one, first)).toBeVisible({ timeout: 60_000 });
  await one
    .getByRole('link', { name: new RegExp(firstRoomName) })
    .first()
    .click();
  await expect
    .poll(() => decodeURIComponent(new URL(one.url()).pathname), { timeout: 20_000 })
    .toContain(firstRoom);

  const two = await context.newPage();
  await two.goto('/home/');
  await expect(accountButton(two, first)).toBeVisible({ timeout: 60_000 });
  await chooseFromAccountMenu(two, new RegExp(`Switch to account .*${second.username}`));
  await expect(accountButton(two, second)).toBeVisible({ timeout: 60_000 });

  // The first tab follows the account and leaves the room the second account is not in.
  await expect(accountButton(one, second)).toBeVisible({ timeout: 60_000 });
  await expect(one.getByText(secondRoomName, { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(() => decodeURIComponent(new URL(one.url()).pathname), { timeout: 20_000 })
    .not.toContain(firstRoom);
  await expect(one.getByText(firstRoom, { exact: true })).toHaveCount(0);
  await expect(one.getByRole('button', { name: 'Retry room info' })).toHaveCount(0);
  if (SHOTS) await one.screenshot({ path: `${SHOTS}/tab-one-after-switch-${browserName}.png` });

  // Back to the first account: the first tab follows again and shows its rooms.
  await chooseFromAccountMenu(two, new RegExp(`Switch to account .*${first.username}`));
  await expect(accountButton(one, first)).toBeVisible({ timeout: 60_000 });
  await expect(one.getByText(firstRoomName, { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(one.getByRole('button', { name: 'Retry room info' })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
};

test('a tab follows an account switch out of a room of the account before (Chromium)', async ({
  browser,
  browserName,
}) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  try {
    await followsSwitchOutOfTheRoom(context, browserName);
  } finally {
    await context.close();
  }
});

test('a tab follows an account switch out of a room of the account before (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    followsSwitchOutOfTheRoom(page.context(), 'webkit')
  );
});
