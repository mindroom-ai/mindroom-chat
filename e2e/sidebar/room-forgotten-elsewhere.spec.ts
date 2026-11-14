import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  accountSessionShot,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { matrixFetch } from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A room left and forgotten on another device while this one was closed: the homeserver leaves a
// forgotten room out of /sync, so the leave never arrives here. The room still goes from the list
// at the next start, and the start after that no longer asks the server about it. Runs in
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against
// the disposable homeserver.
const PASSWORD = 'room-forgotten-elsewhere-spec-password';
const RUN = Date.now().toString(36);
const QUIET_MS = 4_000;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** Whether the client's saved sync (the SDK's IndexedDB store) holds `roomId` as joined. */
const savedSyncHasRoom = (page: Page, roomId: string): Promise<boolean> =>
  page.evaluate(async (id) => {
    const names = (await indexedDB.databases())
      .map((database) => database.name ?? '')
      .filter((name) => name.startsWith('matrix-js-sdk:'));
    const found = await Promise.all(
      names.map(
        (name) =>
          new Promise<boolean>((resolve) => {
            const open = indexedDB.open(name);
            open.onerror = () => resolve(false);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains('sync')) {
                db.close();
                resolve(false);
                return;
              }
              const read = db.transaction('sync').objectStore('sync').getAll();
              read.onerror = () => resolve(false);
              read.onsuccess = () => {
                db.close();
                const records = read.result as Array<{ roomsData?: { join?: object } }>;
                resolve(records.some((record) => Boolean(record.roomsData?.join?.[id as never])));
              };
            };
          })
      )
    );
    return found.some(Boolean);
  }, roomId);

const forgottenRoomLeavesTheList = async (page: Page, browserName: string) => {
  const user = await registerDisposableUser(`rfe_${browserName}_${RUN}`, PASSWORD);
  const oldName = `Old project room ${browserName} ${RUN}`;
  const keptName = `Kept planning room ${browserName} ${RUN}`;
  const old = await createRoom(HOMESERVER, user.accessToken, { name: oldName });
  await createRoom(HOMESERVER, user.accessToken, { name: keptName });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await expect(page.getByRole('link', { name: new RegExp(oldName) })).toBeVisible({
    timeout: 60_000,
  });
  // The room is in the saved sync that the next start replays.
  await expect.poll(() => savedSyncHasRoom(page, old), { timeout: 30_000 }).toBe(true);

  // This device closes; another one leaves the room and forgets it in the same moment.
  await page.goto('about:blank');
  const asUser = { method: 'POST', accessToken: user.accessToken, body: '{}' };
  await matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(old)}/leave`, asUser);
  await matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(old)}/forget`, asUser);

  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(`/rooms/${encodeURIComponent(old)}/`)) asked.push(request.url());
  });

  // The next start drops the room.
  await page.goto('/home/');
  await expect(page.getByRole('link', { name: new RegExp(keptName) })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('link', { name: new RegExp(oldName) })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect.poll(() => savedSyncHasRoom(page, old), { timeout: 30_000 }).toBe(false);

  // The start after that neither lists it nor asks the server about it.
  asked.length = 0;
  await page.reload();
  await expect(page.getByRole('link', { name: new RegExp(keptName) })).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(QUIET_MS);
  await expect(page.getByRole('link', { name: new RegExp(oldName) })).toHaveCount(0);
  await accountSessionShot(page, `forgotten-room-gone-${browserName}`);
  expect(asked, 'requests about the forgotten room').toEqual([]);
};

test('a room forgotten on another device leaves the list (Chromium)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(240_000);
  await forgottenRoomLeavesTheList(page, browserName);
});

test('a room forgotten on another device leaves the list (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    forgottenRoomLeavesTheList(page, 'webkit')
  );
});
