import { expect, test, type Page, type Route } from '@playwright/test';
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

// An account's client checks the server's key backup in the background as it starts. A switch to
// another account closes that client's crypto, also while the check still waits for the server,
// and the server's later answer must not reach the closed crypto: it threw an uncaught "null
// pointer passed to rust" (two-tabs-account-change.spec.ts saw it on a slow Mac). The spec holds
// every /room_keys/version request until the tab has switched away, then lets the server answer.
// Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit,
// against the disposable homeserver.
const PASSWORD = 'account-switch-key-backup-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const KEY_BACKUP_VERSION = '**/_matrix/client/v3/room_keys/version';

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const accountButton = (page: Page, user: DisposableUser) =>
  page.getByRole('button', { name: new RegExp(`^Open account menu for .*${user.username}`) });

/** Waits until `page` shows `user`'s signed-in shell with its room in the list. */
const expectShellOf = async (page: Page, user: DisposableUser, roomName: string) => {
  await expect(accountButton(page, user)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(roomName, { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
};

const switchTo = async (page: Page, user: DisposableUser) => {
  await chooseFromAccountMenu(page, new RegExp(`Switch to account .*${user.username}`));
};

const lateKeyBackupAnswer = async (page: Page, browserName: string) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const first = await registerDisposableUser(`kbsw_a_${browserName}_${RUN}`, PASSWORD);
  const second = await registerDisposableUser(`kbsw_b_${browserName}_${RUN}`, PASSWORD);
  const firstRoom = `First desk ${browserName} ${RUN}`;
  const secondRoom = `Second desk ${browserName} ${RUN}`;
  await createRoom(HOMESERVER, first.accessToken, { name: firstRoom });
  await createRoom(HOMESERVER, second.accessToken, { name: secondRoom });

  await loginWithPassword(page, { homeserver: HOMESERVER, ...first });
  await expectShellOf(page, first, firstRoom);
  await chooseFromAccountMenu(page, 'Add Account');
  await loginWithPassword(page, { homeserver: HOMESERVER, ...second, addAccount: true });
  await expectShellOf(page, second, secondRoom);

  // From here the server answers a key backup check only when the spec lets it. The context's
  // route also sees what the app's service worker fetches.
  const held: Route[] = [];
  let answering = false;
  await page.context().route(KEY_BACKUP_VERSION, async (route) => {
    if (answering) await route.continue();
    else held.push(route);
  });
  await switchTo(page, first);
  await expectShellOf(page, first, firstRoom);
  await expect.poll(() => held.length, { timeout: 30_000 }).toBeGreaterThan(0);

  // Away again while the first account's check still waits; then the server answers it.
  await switchTo(page, second);
  await expectShellOf(page, second, secondRoom);
  answering = true;
  await Promise.all(held.splice(0).map((route) => route.continue()));
  // An error from the answered check shows within moments; give it some time.
  await page.waitForTimeout(3_000);
  await expectShellOf(page, second, secondRoom);

  expect(pageErrors).toEqual([]);
};

test('a key backup check answered after an account switch leaves no error (Chromium)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(240_000);
  await lateKeyBackupAnswer(page, browserName);
});

test('a key backup check answered after an account switch leaves no error (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    lateKeyBackupAnswer(page, 'webkit')
  );
});
