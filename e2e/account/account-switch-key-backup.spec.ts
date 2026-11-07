import { expect, test, type Page, type Route } from '@playwright/test';
import { openSettingsFromAccountRail } from '../helpers/accounts';
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
// The second test does the same with an account that has a key backup on the server; such an
// account also uploads its new room keys there, and the test then holds an upload until the tab
// has switched away and lets the server refuse it.
// Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit,
// against the disposable homeserver.
const PASSWORD = 'account-switch-key-backup-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const KEY_BACKUP_VERSION = '**/_matrix/client/v3/room_keys/version';
// The upload of room keys to the backup, not the download of one key (`/room_keys/keys/<room>/...`).
const KEY_UPLOAD = /\/_matrix\/client\/v3\/room_keys\/keys(\?|$)/;

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

/** Sets up cross-signing, secret storage and a key backup on the server for the signed-in account. */
const turnOnKeyBackup = async (page: Page) => {
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'Privacy & security', exact: true }).click();
  await page.getByRole('button', { name: 'Enable' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('dialog').locator('code')).toHaveText(/^E\w{3}( \w{4}){11}$/, {
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Okay' }).click();
  await expect(page.getByText(/Connected · Version: \S+ · Keys: \d+/)).toBeVisible({
    timeout: 30_000,
  });
  await page.keyboard.press('Escape');
};

const lateKeyUploadAnswer = async (page: Page, browserName: string) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const first = await registerDisposableUser(`kbup_a_${browserName}_${RUN}`, PASSWORD);
  const second = await registerDisposableUser(`kbup_b_${browserName}_${RUN}`, PASSWORD);
  const firstRoom = `Backed up desk ${browserName} ${RUN}`;
  const secondRoom = `Plain desk ${browserName} ${RUN}`;
  await createRoom(HOMESERVER, first.accessToken, { name: firstRoom, encrypted: true });
  await createRoom(HOMESERVER, second.accessToken, { name: secondRoom });

  await loginWithPassword(page, { homeserver: HOMESERVER, ...first });
  await expectShellOf(page, first, firstRoom);
  await turnOnKeyBackup(page);
  await chooseFromAccountMenu(page, 'Add Account');
  await loginWithPassword(page, { homeserver: HOMESERVER, ...second, addAccount: true });
  await expectShellOf(page, second, secondRoom);

  // First the server answers a key backup check only when the spec lets it, as in the test
  // above, but now with this account's backup.
  const heldChecks: Route[] = [];
  const heldUploads: Route[] = [];
  const checksAfterRefusal: string[] = [];
  let phase: 'hold checks' | 'hold uploads' | 'refused' = 'hold checks';
  await page.context().route(KEY_BACKUP_VERSION, async (route) => {
    if (phase === 'hold checks') heldChecks.push(route);
    else {
      if (phase === 'refused')
        checksAfterRefusal.push(route.request().headers().authorization ?? '');
      await route.continue();
    }
  });
  await page.context().route(KEY_UPLOAD, async (route) => {
    if (phase === 'hold uploads' && route.request().method() === 'PUT') heldUploads.push(route);
    else await route.continue();
  });
  await switchTo(page, first);
  await expectShellOf(page, first, firstRoom);
  await expect.poll(() => heldChecks.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await switchTo(page, second);
  await expectShellOf(page, second, secondRoom);
  phase = 'hold uploads';
  const backupVersions = await Promise.all(
    heldChecks.splice(0).map(async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response });
      return ((await response.json()) as { version?: string }).version;
    })
  );
  expect(backupVersions.filter(Boolean).length).toBeGreaterThan(0);

  // Then the server answers a key upload only when the spec lets it.
  await switchTo(page, first);
  await expectShellOf(page, first, firstRoom);
  // A message in the encrypted room makes a room key, which goes to the backup within 10 s.
  await page.getByRole('link', { name: firstRoom }).first().click();
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await composer.click();
  await page.keyboard.type('Notes for the backup');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-pending-send-icon]')).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(() => heldUploads.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const firstAccount = heldUploads[0]!.request().headers().authorization;

  // Away again while the upload waits; then the server refuses it, as when another session has
  // replaced the backup in the meantime.
  await switchTo(page, second);
  await expectShellOf(page, second, secondRoom);
  phase = 'refused';
  await Promise.all(
    heldUploads.splice(0).map((route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ errcode: 'M_NOT_FOUND', error: 'Unknown backup version' }),
      })
    )
  );
  // An error from the answered check or upload shows within moments; give it some time.
  await page.waitForTimeout(3_000);
  await expectShellOf(page, second, secondRoom);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((text) => text.includes('null pointer'))).toEqual([]);
  // The stopped client asks the server nothing more.
  expect(checksAfterRefusal.filter((account) => account === firstAccount)).toEqual([]);
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

test('a key upload refused after an account switch leaves no error (Chromium)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(240_000);
  await lateKeyUploadAnswer(page, browserName);
});

test('a key upload refused after an account switch leaves no error (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    lateKeyUploadAnswer(page, 'webkit')
  );
});
