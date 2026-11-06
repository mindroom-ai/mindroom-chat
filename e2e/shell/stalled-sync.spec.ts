import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { sendRoomMessage } from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A /sync request that the network swallows, with no answer and no reset, as on a stalled mobile
// link or a captive network (L7-F014). Nothing fails, so neither the SDK nor the homeserver check
// notices; the SDK itself gives up on the request only after 110 s. The client must show the
// lost connection once the request is well past its long-poll timeout (30 s), and clear it on
// the next answer. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit, against the disposable homeserver.
const PASSWORD = 'stalled-sync-spec-password';
const RUN = Date.now().toString(36);
// The long-poll timeout plus the client's margin, plus room for a busy machine.
const NOTICE_WITHIN_MS = 70_000;

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
  serviceWorkers: 'block',
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const isSync = (url: URL) => url.pathname.endsWith('/_matrix/client/v3/sync');

const stalledSyncShowsLostConnection = async (
  context: BrowserContext,
  page: Page,
  browserName: string
) => {
  const user = await registerDisposableUser(`stalled_${browserName}_${RUN}`, PASSWORD);
  const room = await createRoom(HOMESERVER, user.accessToken, {
    name: `Stalled desk ${browserName} ${RUN}`,
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await page.goto(`/home/${encodeURIComponent(room)}`);
  const status = page.getByTestId('client-sync-status');
  await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible({ timeout: 30_000 });
  // Catching up ends after a long poll returns; a message ends the current one.
  await sendRoomMessage(HOMESERVER, user.accessToken, room, {
    msgtype: 'm.text',
    body: 'Before the network stalls',
  });
  await expect(page.getByText('Before the network stalls').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(status).toHaveCount(0, { timeout: 45_000 });

  const held: Route[] = [];
  const hold = (route: Route) => {
    held.push(route);
  };
  await context.route(isSync, hold);
  // The long poll in flight still answers; this message ends it, and the next one is held.
  await sendRoomMessage(HOMESERVER, user.accessToken, room, {
    msgtype: 'm.text',
    body: 'Last message before the stall',
  });
  await expect(page.getByText('Last message before the stall').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => held.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const heldAt = Date.now();

  await expect(status).toHaveText(/Connection Lost!/, { timeout: NOTICE_WITHIN_MS });
  const shownAfterMs = Date.now() - heldAt;
  // eslint-disable-next-line no-console
  console.log(`[stalled-sync:${browserName}] notice after ${shownAfterMs} ms`);
  // Not before the long poll could have answered on its own.
  expect(shownAfterMs).toBeGreaterThan(30_000);

  // The network comes back: the held request reaches the server, and a message ends its poll.
  await context.unroute(isSync, hold);
  await Promise.all(held.map((route) => route.continue().catch(() => undefined)));
  await sendRoomMessage(HOMESERVER, user.accessToken, room, {
    msgtype: 'm.text',
    body: 'After the network came back',
  });
  await expect(page.getByText('After the network came back').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(status).toHaveCount(0, { timeout: 15_000 });
};

test('a /sync request that never answers shows the lost connection until the next answer (Chromium)', async ({
  context,
  page,
  browserName,
}) => {
  test.setTimeout(240_000);
  await stalledSyncShowsLostConnection(context, page, browserName);
});

test('a /sync request that never answers shows the lost connection until the next answer (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await onWebKitPage(
    { viewport: { width: 1280, height: 800 }, baseURL, serviceWorkers: 'block' },
    (page) => stalledSyncShowsLostConnection(page.context(), page, 'webkit')
  );
});
