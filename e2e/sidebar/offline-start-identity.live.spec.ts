import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { readSessionStore } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { openThreadsCategory } from '../helpers/threadsCategory';

// An offline start shows what the client showed online, from its caches: the sidebar's THREADS
// rows keep their titles (also for rooms not opened in this page load), the room's thread cards
// keep every participant, and the rail keeps the space's picture. The thread's root lies outside
// the saved sync, as in a busy room, so only the event cache can name it.
const PASSWORD = 'offline-start-identity-password';

// OFFLINE_IDENTITY_SHOTS=<directory> also saves screenshots of the checked states.
const SHOTS = process.env.OFFLINE_IDENTITY_SHOTS;
const shot = async (page: Page, name: string, browserName: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${browserName}.png` });
};

// A 48 px square with a pale disc, the space's picture.
const SPACE_PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAACMUlEQVR42s3WaTfUYRgG8OvjIPua7LvsOw1Fu6JIpMVOlnZLpVAzGMMQWbMTbUTSYn/jG/Sm9z1z5o3Oecbk//ybc59zfYDfec557uuCmVZp1qU071SZa1QWHa0W6rZD7Sztlm1qy1a1larDSqmxfqmxftFpw9LSZdustWvS2j3vtn/WY9/Y49D4yuFpr+OTXsfHfU4NfU71r53r+53r+l1qB1weDR5+OOj6YMj1/vARlnsjbndH3O68ca8Zda8e9aga86ga96wc97w94VUx6VU+6V025VM2DVIan9JpkNL4lsyAlMa3eAakNH5FsyCl8St8C1Ia/wIdiJDGv2AOpDQBt+Yhr+b3r11D+RdNwM15mEajj1FN4I13kEVjlLI3+2gCr7+Had7mL5BhTVA+A5lWo48hTdC1DzC9Rh+uJlgHEvvhkkFcTXDeRwjeG+kgnuZo7icIXj/JIK4m5CoDid1i6SCeJiRnAYLNIBnE1YReWYRgT0kH8TSh2YsQbE3JIK4mLPszBDtcOoinCctagviikFETfpmB5Ng3cmnCLy1DlrV1INA+mohMBpJv+wm+DdNEZHyBvEtUUBOZsYL/sYsN9ZRRTeTFFZDSRF34ClKaqPRVkNJEn18FKU3MuW8gpYk5+x2kNLE6ECVN7JkfIKWJO81AlDRxp36ClCb+5BpIaeLT1kBKk5C6DlKahNQNkNIknmAgSprE45sgpUlK2QIpTVLyFkhpjim2QUqjUOz8AagjATipQGfoAAAAAElFTkSuQmCC',
  'base64'
);

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

const uploadPicture = async (accessToken: string): Promise<string> => {
  const response = await fetch(`${getHomeserver()}/_matrix/media/v3/upload?filename=space.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/png' },
    body: SPACE_PICTURE,
  });
  expect(response.ok, `media upload answered ${response.status}`).toBe(true);
  return ((await response.json()) as { content_uri: string }).content_uri;
};

const createRoom = async (owner: Account, body: Record<string, unknown>): Promise<string> =>
  (
    await matrixFetch<{ room_id: string }>(getHomeserver(), '/createRoom', {
      method: 'POST',
      accessToken: owner.accessToken,
      body: JSON.stringify({ preset: 'private_chat', ...body }),
    })
  ).room_id;

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
            // Room data and account data are saved in stores of their own.
            const read = (store: string) =>
              new Promise<string>((resolve, reject) => {
                const request = db.transaction(store).objectStore(store).getAll();
                request.onsuccess = () => resolve(JSON.stringify(request.result));
                request.onerror = () => reject(request.error);
              });
            try {
              const saved = await Promise.all(['sync', 'accountData'].map(read));
              return saved.some((json) => json.includes(wanted));
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

/** True once the image has loaded pixels (a broken or missing image has none). */
const imageLoaded = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)
    .catch(() => false);

/** Cuts the page off from the homeserver; the app's own files still load. */
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

test.use({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });

test('an offline start keeps thread titles, thread participants and the space picture @webkit', async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  test.setTimeout(180_000);
  const homeserver = getHomeserver();
  const viewer = await register('offline_viewer', 'Offline Viewer');
  const helper = await register('offline_helper', 'Thread Helper');
  const run = Date.now().toString(36);

  const picture = await uploadPicture(viewer.accessToken);
  const spaceName = `Offline space ${run}`;
  const spaceId = await createRoom(viewer, {
    name: spaceName,
    creation_content: { type: 'm.space' },
    initial_state: [{ type: 'm.room.avatar', state_key: '', content: { url: picture } }],
  });
  const roomName = `Offline titles ${run}`;
  const roomId = await createRoom(viewer, { name: roomName, invite: [helper.userId] });
  await addRoomToSpace(homeserver, viewer.accessToken, spaceId, roomId);
  await joinRoom(homeserver, helper.accessToken, roomId);
  // A room the offline page never opens: its thread's root is older than the saved sync.
  const otherName = `Offline other ${run}`;
  const otherId = await createRoom(viewer, { name: otherName, invite: [helper.userId] });
  await joinRoom(homeserver, helper.accessToken, otherId);

  const rootTitle = `Cached title root ${run}`;
  const rootId = await sendRoomMessage(homeserver, viewer.accessToken, roomId, {
    msgtype: 'm.text',
    body: rootTitle,
  });
  const otherTitle = `Unopened room root ${run}`;
  const otherRootId = await sendRoomMessage(homeserver, viewer.accessToken, otherId, {
    msgtype: 'm.text',
    body: otherTitle,
  });
  // More room messages than a sync's timeline holds, so the roots are known only from elsewhere.
  for (let index = 0; index < 30; index += 1) {
    await Promise.all([
      sendRoomMessage(homeserver, helper.accessToken, roomId, {
        msgtype: 'm.notice',
        body: `Room activity ${index}`,
      }),
      sendRoomMessage(homeserver, helper.accessToken, otherId, {
        msgtype: 'm.notice',
        body: `Other activity ${index}`,
      }),
    ]);
  }
  const replyId = await sendRoomMessage(
    homeserver,
    helper.accessToken,
    roomId,
    reply(rootId, `Helper reply ${run}`)
  );
  const otherReplyId = await sendRoomMessage(
    homeserver,
    helper.accessToken,
    otherId,
    reply(otherRootId, `Other helper reply ${run}`)
  );

  await loginWithPassword(page, { homeserver, username: viewer.username, password: PASSWORD });
  await seedRoomOverviewState({ page, roomId, userId: viewer.userId, viewMode: 'compact' });
  await seedRoomOverviewState({
    page,
    roomId: otherId,
    userId: viewer.userId,
    viewMode: 'compact',
  });

  // Online: both rooms' thread lists load, so their roots reach the event cache.
  for (const [id, title] of [
    [otherId, otherTitle],
    [roomId, rootTitle],
  ] as const) {
    await page.goto(`/home/${encodeURIComponent(id)}`);
    const card = page.locator(`[data-thread-root-id="${id === roomId ? rootId : otherRootId}"]`);
    await expect(card).toContainText(title, { timeout: 20_000 });
  }
  const card = page.locator(`[data-thread-root-id="${rootId}"]`);
  await expect(card.getByTitle('Thread Helper', { exact: true })).toBeVisible();
  await expect(card.getByTitle('Offline Viewer', { exact: true })).toBeVisible();
  await openThreadsCategory(page);
  const sidebar = page.getByTestId('thread-nav-category');
  await expect(sidebar.getByText(otherTitle, { exact: true })).toBeVisible();
  await expect(sidebar.getByText(rootTitle, { exact: true })).toBeVisible();
  const spaceImage = `[data-id="${spaceId}"] img`;
  await expect.poll(() => imageLoaded(page, spaceImage), { timeout: 20_000 }).toBe(true);
  await waitForSavedSync(page, replyId);
  await waitForSavedSync(page, otherReplyId);
  // Let the cache writes of the thread lists settle before the page goes away.
  await page.waitForTimeout(1_000);

  await page.close();
  await goOffline(context, baseURL!, browserName);
  const offline = await context.newPage();
  await offline.goto('/home/');
  expect(await offline.evaluate(() => navigator.onLine)).toBe(false);

  // Neither room is open: the sidebar rows still carry their titles.
  const offlineSidebar = offline.getByTestId('thread-nav-category');
  await expect(offlineSidebar.getByText(otherTitle, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(offlineSidebar.getByText(rootTitle, { exact: true })).toBeVisible();
  // Playwright's WebKit keeps no cache storage across pages (an ephemeral context drops it between
  // pages, a persistent profile never writes it), which Safari does; WebKit checks the picture
  // after reconnect below.
  if (browserName !== 'webkit') {
    await expect.poll(() => imageLoaded(offline, spaceImage), { timeout: 15_000 }).toBe(true);
  }

  await shot(offline, 'offline-start-sidebar', browserName);

  // The room's card shows both people, as it did online.
  await offline.goto(`/home/${encodeURIComponent(roomId)}`);
  const offlineCard = offline.locator(`[data-thread-root-id="${rootId}"]`);
  await expect(offlineCard).toContainText(rootTitle, { timeout: 15_000 });
  await expect(offlineCard.getByTitle('Thread Helper', { exact: true })).toBeVisible();
  await expect(offlineCard.getByTitle('Offline Viewer', { exact: true })).toBeVisible();
  await shot(offline, 'offline-start-thread-cards', browserName);

  await goOnline(context, offline, browserName);
  await expect.poll(() => imageLoaded(offline, spaceImage), { timeout: 30_000 }).toBe(true);
  await expect(offlineSidebar.getByText(otherTitle, { exact: true })).toBeVisible();
});

test('an offline start shows a rename and a roaming setting made shortly before @webkit', async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  test.setTimeout(150_000);
  const homeserver = getHomeserver();
  const viewer = await register('offline_renamer', 'Name Before');
  const helper = await register('offline_member', 'Room Member');
  const run = Date.now().toString(36);
  const roomId = await createRoom(viewer, {
    name: `Offline rename ${run}`,
    invite: [helper.userId],
  });
  await joinRoom(homeserver, helper.accessToken, roomId);
  const messageId = await sendRoomMessage(homeserver, viewer.accessToken, roomId, {
    msgtype: 'm.text',
    body: `Signed message ${run}`,
  });

  await loginWithPassword(page, { homeserver, username: viewer.username, password: PASSWORD });
  await seedRoomOverviewState({ page, roomId, userId: viewer.userId, viewMode: 'threaded' });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const message = page.locator(`[data-message-id="${messageId}"]`);
  await expect(message).toContainText('Name Before', { timeout: 20_000 });
  await expect(page.getByText(/Room Member joined the room/)).toBeVisible();
  await waitForSavedSync(page, roomId);

  // A rename and a roaming setting, both made well within the SDK's five minutes between saves.
  await matrixFetch(homeserver, `/profile/${encodeURIComponent(viewer.userId)}/displayname`, {
    method: 'PUT',
    accessToken: viewer.accessToken,
    body: JSON.stringify({ displayname: 'Name After' }),
  });
  await expect(message).toContainText('Name After', { timeout: 20_000 });
  await matrixFetch(
    homeserver,
    `/user/${encodeURIComponent(viewer.userId)}/account_data/io.mindroom.client.settings`,
    {
      method: 'PUT',
      accessToken: viewer.accessToken,
      body: JSON.stringify({ version: 1, hideMembershipEvents: true }),
    }
  );
  await expect(page.getByText(/Room Member joined the room/)).toHaveCount(0, { timeout: 20_000 });
  await waitForSavedSync(page, 'Name After');
  await waitForSavedSync(page, 'hideMembershipEvents');

  await page.close();
  await goOffline(context, baseURL!, browserName);
  const offline = await context.newPage();
  await offline.goto(`/home/${encodeURIComponent(roomId)}`);
  expect(await offline.evaluate(() => navigator.onLine)).toBe(false);
  const offlineMessage = offline.locator(`[data-message-id="${messageId}"]`);
  await expect(offlineMessage).toContainText('Name After', { timeout: 15_000 });
  await expect(offline.getByText(/Room Member joined the room/)).toHaveCount(0);
  await shot(offline, 'offline-start-rename', browserName);
});

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('an offline reload keeps the space picture the worker loaded', async ({
    page,
    context,
    browserName,
  }) => {
    // Playwright's WebKit runs no service workers.
    test.skip(browserName !== 'chromium', 'Service workers run in Chromium only');
    test.setTimeout(120_000);
    const viewer = await register('offline_sw_viewer', 'Worker Viewer');
    const picture = await uploadPicture(viewer.accessToken);
    const spaceId = await createRoom(viewer, {
      name: `Worker space ${Date.now().toString(36)}`,
      creation_content: { type: 'm.space' },
      initial_state: [{ type: 'm.room.avatar', state_key: '', content: { url: picture } }],
    });

    await loginWithPassword(page, {
      homeserver: getHomeserver(),
      username: viewer.username,
      password: PASSWORD,
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller), { timeout: 30_000 })
      .toBe(true);
    // Load the picture through the worker that now controls the page.
    await page.reload();
    const spaceImage = `[data-id="${spaceId}"] img`;
    await expect.poll(() => imageLoaded(page, spaceImage), { timeout: 20_000 }).toBe(true);
    // The worker keeps the picture it loaded.
    await expect
      .poll(() =>
        page.evaluate(async () => (await (await caches.open('mindroom-avatars-v1')).keys()).length)
      )
      .toBeGreaterThan(0);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('client-sync-status')).toHaveText('Connection Lost!', {
      timeout: 20_000,
    });
    await expect.poll(() => imageLoaded(page, spaceImage), { timeout: 15_000 }).toBe(true);
  });
});
