import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { readSessionStore } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, matrixFetch, seedRoomOverviewState, sendRoomMessage } from '../helpers/matrix';

// A thread the reader opened online opens again offline from the client's caches, in a room
// without agents or approvals. Its root lies outside the saved sync, as in a busy room. Offline,
// the approval history cannot load, which is no failure to report: no "Some approval history
// could not be loaded." notice, offline or after the connection returns, and the history loads
// once it does. The banner names the thread by its root, as online, not "Thread View". Runs in
// Chromium and WebKit.
const PASSWORD = 'offline-thread-open-password';

// OFFLINE_THREAD_SHOTS=<directory> also saves screenshots of the checked states.
const SHOTS = process.env.OFFLINE_THREAD_SHOTS;
const shot = async (page: Page, name: string, browserName: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${browserName}.png` });
};

type Account = { username: string; userId: string; accessToken: string };

const register = async (prefix: string, displayname: string): Promise<Account> => {
  const homeserver = getHomeserver();
  const username = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(homeserver, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
};

const reply = (rootId: string, body: string) => ({
  msgtype: 'm.text',
  body,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

/** Waits until the SDK's saved sync (what an offline start reads) holds `text`. */
const waitForSavedSync = async (page: Page, text: string) => {
  const { activeSessionId } = await readSessionStore(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ name, wanted }) => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open(name);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            const read = new Promise<string>((resolve, reject) => {
              const request = db.transaction('sync').objectStore('sync').getAll();
              request.onsuccess = () => resolve(JSON.stringify(request.result));
              request.onerror = () => reject(request.error);
            });
            try {
              return (await read).includes(wanted);
            } finally {
              db.close();
            }
          },
          { name: `matrix-js-sdk:web-sync-store::${activeSessionId}`, wanted: text }
        ),
      { message: `the saved sync holds ${text}`, timeout: 30_000 }
    )
    .toBe(true);
};

/** Cuts the pages off from the homeserver; the app's own files still load. */
const goOffline = async (context: BrowserContext, baseURL: string, browserName: string) => {
  // Chromium treats the intercepted app document as public address space.
  if (browserName === 'chromium') {
    await context.grantPermissions(['local-network-access'], { origin: baseURL });
  }
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === new URL(baseURL).origin) {
      await route.fulfill({ response: await route.fetch() });
    } else {
      await route.abort('internetdisconnected');
    }
  });
  // Desktop WebKit blocks navigation before routes can serve bundled assets.
  if (browserName === 'webkit') {
    await context.addInitScript(() =>
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    );
  } else {
    await context.setOffline(true);
  }
};

const goOnline = async (context: BrowserContext, page: Page, browserName: string) => {
  await context.unrouteAll({ behavior: 'wait' });
  await context.setOffline(false);
  if (browserName === 'webkit') {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
  }
};

type ThreadRoom = {
  viewer: Account;
  roomId: string;
  rootId: string;
  rootTitle: string;
  replyText: string;
  threadPath: string;
};

/** A room of two people, no agents, with a thread whose root is older than a sync's timeline. */
const createThreadRoom = async (): Promise<ThreadRoom> => {
  const homeserver = getHomeserver();
  const viewer = await register('offline_thread_viewer', 'Thread Reader');
  const helper = await register('offline_thread_helper', 'Thread Writer');
  const run = Date.now().toString(36);
  const roomId = await createRoom(homeserver, viewer.accessToken, {
    name: `Offline thread ${run}`,
    invite: [helper.userId],
  });
  await joinRoom(homeserver, helper.accessToken, roomId);
  const rootTitle = `Harbor schedule for the week ${run}`;
  const rootId = await sendRoomMessage(homeserver, viewer.accessToken, roomId, {
    msgtype: 'm.text',
    body: rootTitle,
  });
  const replyText = `The crane inspection moves to Thursday morning ${run}`;
  await sendRoomMessage(homeserver, helper.accessToken, roomId, reply(rootId, replyText));
  // More room messages than a sync's timeline holds, so the root is known only from the caches.
  for (let index = 0; index < 30; index += 1) {
    await sendRoomMessage(homeserver, helper.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Dock update ${index}: the north berth stays closed until the tide turns.`,
    });
  }
  const threadPath = `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;
  return { viewer, roomId, rootId, rootTitle, replyText, threadPath };
};

/** Opens the thread online, so the caches hold it, and closes the page. */
const visitThreadOnline = async (page: Page, setup: ThreadRoom) => {
  await loginWithPassword(page, {
    homeserver: getHomeserver(),
    username: setup.viewer.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId: setup.roomId,
    userId: setup.viewer.userId,
    viewMode: 'threaded',
  });
  await page.goto(setup.threadPath);
  await expect(page.getByText(setup.replyText, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-thread-context-banner]')).toContainText(setup.rootTitle);
  await waitForSavedSync(page, 'Dock update 29');
  // Let the cache writes of the thread settle before the page goes away.
  await page.waitForTimeout(1_000);
  await page.close();
};

test.use({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });

test('an offline thread shows no approval history error, and loads it after reconnecting @webkit', async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  test.setTimeout(180_000);
  const setup = await createThreadRoom();
  await visitThreadOnline(page, setup);

  await goOffline(context, baseURL!, browserName);
  const offline = await context.newPage();
  await offline.goto(setup.threadPath);
  expect(await offline.evaluate(() => navigator.onLine)).toBe(false);
  await expect(offline.getByText(setup.replyText, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // The approval history request fails at once offline; give the view time to report it.
  await offline.waitForTimeout(5_000);
  await shot(offline, 'offline-thread', browserName);
  await expect(offline.getByText(/approval history/i)).toHaveCount(0);
  await expect(offline.getByRole('button', { name: 'Retry history' })).toHaveCount(0);

  // Back online, the thread's approval history loads without a click: the room is not encrypted,
  // so its request names the approval event type.
  const relationsPath = `/relations/${encodeURIComponent(
    setup.rootId
  )}/m.thread/io.mindroom.tool_approval`;
  const historyLoaded = offline.waitForResponse(
    (response) => response.url().includes(relationsPath) && response.ok(),
    { timeout: 45_000 }
  );
  await goOnline(context, offline, browserName);
  await historyLoaded;
  await offline.waitForTimeout(1_000);
  await shot(offline, 'online-again-thread', browserName);
  await expect(offline.getByText(/approval history/i)).toHaveCount(0);
  await expect(offline.getByRole('button', { name: 'Retry history' })).toHaveCount(0);
});

test('an offline thread banner names the thread by its cached root @webkit', async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  test.setTimeout(180_000);
  const setup = await createThreadRoom();
  await visitThreadOnline(page, setup);

  await goOffline(context, baseURL!, browserName);
  const offline = await context.newPage();
  await offline.goto(setup.threadPath);
  expect(await offline.evaluate(() => navigator.onLine)).toBe(false);
  await expect(offline.getByText(setup.replyText, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const banner = offline.locator('[data-thread-context-banner]');
  // The root shows under the banner from the cache; the banner names the thread by it as online.
  await expect(banner.locator('[data-thread-context-root-title]')).toHaveText(setup.rootTitle, {
    timeout: 10_000,
  });
  await expect(banner.getByText('Thread View', { exact: true })).toHaveCount(0);
  await shot(offline, 'offline-thread-banner', browserName);
});
