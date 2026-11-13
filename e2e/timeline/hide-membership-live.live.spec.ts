import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

/**
 * A small room keeps its message on screen while Hide Membership Changes is turned on and off
 * from another device (roaming account data that arrives by sync), also when a rename of the
 * reader arrives with it. Every frame from the first change until the view rests must show the
 * message. The room has one message among its membership rows, the account 25 other rooms; the
 * Threads and Classic views, on a desktop (1280 by 800) and a phone (390 by 844, touch), in
 * Chromium and, when the runner names it, WebKit. HIDE_MEMBERSHIP_SHOTS=<directory> saves the
 * view after each change.
 */

const PASSWORD = 'hide-membership-live-password';
const SHOTS = process.env.HIDE_MEMBERSHIP_SHOTS;
const homeserver = getHomeserver();
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const SETTINGS_TYPE = 'io.mindroom.client.settings';

type Account = { username: string; userId: string; accessToken: string };

const register = async (prefix: string, displayname: string): Promise<Account> => {
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

const rename = (account: Account, displayname: string) =>
  matrixFetch(homeserver, `/profile/${encodeURIComponent(account.userId)}/displayname`, {
    method: 'PUT',
    accessToken: account.accessToken,
    body: JSON.stringify({ displayname }),
  });

/** The setting as another device of the reader writes it. */
const setHideMembership = (account: Account, hide: boolean) =>
  setAccountData(homeserver, account.accessToken, account.userId, SETTINGS_TYPE, {
    version: 1,
    hideMembershipEvents: hide,
  });

type WatchWindow = Window & { messageWatch?: { stop: () => string[] } };

/**
 * Records every frame in which the message row is not the topmost element at any of its points
 * inside the timeline, from now until `stop`, with what the timeline held then.
 */
const watchMessage = (page: Page, messageId: string) =>
  page.evaluate((id) => {
    const blank: string[] = [];
    let running = true;
    const start = performance.now();
    const tick = () => {
      if (!running) return;
      const row = document.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
      const rect = row?.getBoundingClientRect();
      const x = rect ? rect.left + Math.min(rect.width / 2, 160) : 0;
      const shown =
        !!row &&
        !!rect &&
        rect.height > 0 &&
        [rect.top + 4, rect.top + rect.height / 2, rect.bottom - 4].some((y) => {
          if (y < 0 || y > window.innerHeight) return false;
          const hit = document.elementFromPoint(x, y);
          return !!hit && row.contains(hit);
        });
      if (!shown) {
        const inner = document.querySelector<HTMLElement>('[data-testid="room-virtual-inner"]');
        blank.push(
          `${Math.round(performance.now() - start)} ms: row ${
            row ? `at ${Math.round(rect?.top ?? 0)}+${Math.round(rect?.height ?? 0)}` : 'unmounted'
          }, list ${inner ? `${inner.style.height} margin ${inner.style.marginTop || 0}` : 'none'}`
        );
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as WatchWindow).messageWatch = {
      stop: () => {
        running = false;
        return blank;
      },
    };
  }, messageId);

const stopWatch = (page: Page) =>
  page.evaluate(() => (window as WatchWindow).messageWatch?.stop() ?? ['no watch']);

const joinedRow = (page: Page) => page.getByText(/Room Member joined the room/);

const checkRoom = async (page: Page, viewMode: 'threaded' | 'classic', label: string) => {
  const run = Date.now().toString(36);
  const viewer = await register('hm_viewer', 'Name Before');
  const helper = await register('hm_member', 'Room Member');
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createPrivateRoom(homeserver, viewer.accessToken, {
        name: `Project ${index + 1}`,
        topic: 'Another room of the account',
      })
    )
  );
  const roomId = await createPrivateRoom(homeserver, viewer.accessToken, {
    name: `Membership ${run}`,
    topic: 'A small room with one message',
    invite: [helper.userId],
  });
  await joinRoom(homeserver, helper.accessToken, roomId);
  const messageId = await sendRoomMessage(homeserver, viewer.accessToken, roomId, {
    msgtype: 'm.text',
    body: `Signed message ${run}: the release checklist is in the pinned notes.`,
  });

  await loginWithPassword(page, { homeserver, username: viewer.username, password: PASSWORD });
  await seedRoomOverviewState({ page, roomId, userId: viewer.userId, viewMode });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const message = page.locator(`[data-message-id="${messageId}"]`);
  await expect(message).toContainText('Name Before', { timeout: 30_000 });
  await expect(joinedRow(page)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_000);

  await watchMessage(page, messageId);
  // The setting turns on with a rename arriving in the same moment, then off and on again.
  await Promise.all([rename(viewer, 'Name After'), setHideMembership(viewer, true)]);
  await expect(joinedRow(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(message).toContainText('Name After', { timeout: 20_000 });
  await page.waitForTimeout(1_500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-hidden.png` });
  await setHideMembership(viewer, false);
  await expect(joinedRow(page)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-shown.png` });
  await Promise.all([rename(viewer, 'Name Again'), setHideMembership(viewer, true)]);
  await expect(joinedRow(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(message).toContainText('Name Again', { timeout: 20_000 });
  await page.waitForTimeout(1_500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-hidden-again.png` });
  expect(await stopWatch(page), `frames without the message (${label})`).toEqual([]);
};

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

test.describe('Hide Membership Changes from another device keeps a small room on screen', () => {
  test.beforeAll(async () => {
    let reachable = false;
    try {
      reachable = (await fetch(`${homeserver}/_matrix/client/versions`)).ok;
    } catch {
      reachable = false;
    }
    test.skip(!reachable, `No homeserver at ${homeserver}`);
  });

  (['chromium', 'webkit'] as const).forEach((engine) => {
    (
      [
        ['desktop', DESKTOP],
        ['phone', PHONE],
      ] as const
    ).forEach(([form, options]) => {
      (['threaded', 'classic'] as const).forEach((viewMode) => {
        const label = `${viewMode}-${engine}-${form}`;
        test(`${viewMode} view, ${engine}, ${form}`, async ({ browser, baseURL }) => {
          test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
          test.setTimeout(180_000);
          const host = engine === 'webkit' ? await launchWebKit() : undefined;
          const context = await (host ?? browser).newContext({ ...options, baseURL });
          try {
            await checkRoom(await context.newPage(), viewMode, label);
          } finally {
            await context.close();
            await host?.close();
          }
        });
      });
    });
  });
});
