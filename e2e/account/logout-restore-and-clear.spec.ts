import { expect, test, type Page } from '@playwright/test';
import { expectActiveStoredUsername, logoutActiveAccount } from '../helpers/accounts';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  accountSessionShot,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Two accounts in one browser. Logging out the active one opens the other where it was, in its
// last room. Logging out the last one leaves nothing in localStorage that names either account,
// so a shared computer does not tell who used it. Runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver.
const PASSWORD = 'logout-restore-and-clear-spec-password';
const RUN = Date.now().toString(36);

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/**
 * Once `slowDeletes` is set on the page, every IndexedDB deletion reports success 3 s late, as on
 * a slow disk: the remaining account then starts in the page while the removed one's data goes,
 * before the page loads again.
 */
const slowDatabaseDeletes = (page: Page) =>
  page.addInitScript(() => {
    const { deleteDatabase } = IDBFactory.prototype;
    IDBFactory.prototype.deleteDatabase = function slowDelete(this: IDBFactory, name: string) {
      const request = deleteDatabase.call(this, name);
      if (!(window as { slowDeletes?: boolean }).slowDeletes) return request;
      let handler: ((event: Event) => unknown) | null = null;
      request.addEventListener('success', (event) => {
        setTimeout(() => handler?.call(request, event), 3_000);
      });
      Object.defineProperty(request, 'onsuccess', {
        get: () => handler,
        set: (next: ((event: Event) => unknown) | null) => {
          handler = next;
        },
      });
      return request;
    };
  });

/** localStorage entries whose key or value names one of `userIds`. */
const storageNaming = (page: Page, userIds: string[]): Promise<string[]> =>
  page.evaluate((ids) => {
    const found: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) ?? '';
      const value = localStorage.getItem(key) ?? '';
      if (ids.some((id) => key.includes(id) || value.includes(id))) found.push(key);
    }
    return found;
  }, userIds);

const logoutRestoresAndClears = async (page: Page, browserName: string) => {
  const first = await registerDisposableUser(`lrc_first_${browserName}_${RUN}`, PASSWORD);
  const second = await registerDisposableUser(`lrc_second_${browserName}_${RUN}`, PASSWORD);
  const room = await createRoom(HOMESERVER, first.accessToken, {
    name: `Field notes ${browserName} ${RUN}`,
  });

  await slowDatabaseDeletes(page);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...first });
  await page.goto(`/home/${encodeURIComponent(room)}`);
  await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible({ timeout: 60_000 });

  await chooseFromAccountMenu(page, 'Add Account');
  await loginWithPassword(page, { homeserver: HOMESERVER, ...second, addAccount: true });
  await expectActiveStoredUsername(page, second.username);

  // The remaining account opens in its last room, after the page loads again, also when it
  // started in the page meanwhile.
  await page.evaluate(() => Object.assign(window, { slowDeletes: true }));
  const reloaded = page.waitForEvent('load', { timeout: 60_000 });
  await logoutActiveAccount(page);
  await reloaded;
  await expectActiveStoredUsername(page, first.username);
  await expect.poll(() => decodeURIComponent(page.url()), { timeout: 60_000 }).toContain(room);
  await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible({ timeout: 60_000 });
  await accountSessionShot(page, `logout-remaining-account-${browserName}`);

  // After the last logout no entry names either account.
  const reloadedAgain = page.waitForEvent('load', { timeout: 60_000 });
  await logoutActiveAccount(page);
  await reloadedAgain;
  await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 60_000 });
  expect(await storageNaming(page, [first.userId, second.userId])).toEqual([]);
};

test('logout opens the other account where it was and leaves no account behind (Chromium)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(240_000);
  await logoutRestoresAndClears(page, browserName);
});

test('logout opens the other account where it was and leaves no account behind (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    logoutRestoresAndClears(page, 'webkit')
  );
});
