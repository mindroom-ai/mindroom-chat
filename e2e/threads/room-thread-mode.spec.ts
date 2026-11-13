import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { matrixFetch, sendStateEvent } from '../helpers/matrix';
import { roomViewSwitch } from '../helpers/roomViewSwitch';
import {
  AI_RUN,
  DESKTOP,
  PASSWORD,
  PHONE,
  RUN,
  SCHEMES,
  createOtherRooms,
  join,
  register,
  say,
  setLook,
  shot,
  withRetry,
  type Account,
} from '../helpers/designChoices';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  CHROMIUM_WITH_SCROLLBARS,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// MindRoom publishes a room's effective thread mode as room state `io.mindroom.thread_mode`
// (state key "", content {"mode": "room" | "thread" | "mixed"}). A room whose agents answer in
// the main timeline ("room") opens in the Threads view while the reader has not chosen a view, so
// watching a reply reads it, instead of as Compact cards that leave every finished reply unread
// (L2-F002, design decision #2). The view follows the state while the room is open until the
// reader chooses one; a chosen view always wins, also after a reload. "mixed" and a room without
// the state keep the Compact default. The router agent, the room's admin, publishes the state, as
// MindRoom does. Among 25 rooms, on a desktop (1440 by 900) and a phone (390 by 844, touch),
// light and dark, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit,
// in WebKit. Set DESIGN_CHOICES_SHOTS=<directory> to save screenshots.
const ENGINES = ['chromium', ...(WEBKIT_EXECUTABLE ? ['webkit'] : [])] as const;
const ROOM_MODE_ROOM = 'Support desk';
const MIXED_ROOM = 'Release desk';
const PLAIN_ROOM = 'Planning desk';
const THREAD_MODE = 'io.mindroom.thread_mode';

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

type Seed = {
  reader: Account;
  router: Account;
  helper: Account;
  roomId: string;
  mixedRoomId: string;
  plainRoomId: string;
};

const setMode = (router: Account, roomId: string, mode: string) =>
  withRetry(() => sendStateEvent(HOMESERVER, router.token, roomId, THREAD_MODE, '', { mode }));

/** A room the router creates with the reader and the helper agent, and a short exchange in it. */
const agentRoom = async (reader: Account, router: Account, helper: Account, name: string) => {
  const roomId = await withRetry(() =>
    createRoom(HOMESERVER, router.token, { name, invite: [reader.userId, helper.userId] })
  );
  await join(reader, roomId);
  await join(helper, roomId);
  await say(reader, roomId, `What is still open before the launch? (${name})`);
  await say(
    helper,
    roomId,
    'Two items: the onboarding copy review on Thursday and the payment retry fix, which passed ten runs in a row.',
    undefined,
    AI_RUN
  );
  return roomId;
};

const seed = async (label: string): Promise<Seed> => {
  const id = `${label}_${RUN}_${randomUUID().slice(0, 6)}`;
  const reader = await register(`rtm_${id}`, 'Robin Tester');
  const router = await register(`mindroom_router_${id}`, 'Router');
  const helper = await register(`mindroom_helper_${id}`, 'Helper');
  await createOtherRooms(reader);
  const roomId = await agentRoom(reader, router, helper, ROOM_MODE_ROOM);
  await setMode(router, roomId, 'room');
  const mixedRoomId = await agentRoom(reader, router, helper, MIXED_ROOM);
  await setMode(router, mixedRoomId, 'mixed');
  const plainRoomId = await agentRoom(reader, router, helper, PLAIN_ROOM);
  return { reader, router, helper, roomId, mixedRoomId, plainRoomId };
};

/** The reader's notification count for the room, as the server keeps it. */
const notificationCount = async (reader: Account, roomId: string): Promise<number> => {
  const filter = JSON.stringify({ room: { rooms: [roomId], timeline: { limit: 1 } } });
  const body = await matrixFetch<{
    rooms?: { join?: Record<string, { unread_notifications?: { notification_count?: number } }> };
  }>(HOMESERVER, `/sync?timeout=0&filter=${encodeURIComponent(filter)}`, {
    accessToken: reader.token,
  });
  return body.rooms?.join?.[roomId]?.unread_notifications?.notification_count ?? 0;
};

const compactCards = (page: Page) => page.locator('[data-compact-room-view="true"]');

const openRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.getByText('Two items: the onboarding copy review').first()).toBeVisible({
    timeout: 30_000,
  });
};

/** Threads: the room's messages as rows, no Compact cards. */
const expectThreads = async (page: Page, where: string) => {
  await expect(compactCards(page), `${where}: no Compact cards`).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(
    page.locator('[data-message-id]').filter({ hasText: 'Two items: the onboarding' }).first(),
    `${where}: the reply as a row`
  ).toBeVisible();
};

const expectCompact = async (page: Page, where: string) => {
  await expect(compactCards(page), `${where}: Compact cards`).toBeVisible({ timeout: 20_000 });
};

const newPage = async (
  engine: (typeof ENGINES)[number],
  browser: Browser,
  options: BrowserContextOptions
) => {
  const owner = engine === 'webkit' ? await launchWebKit() : browser;
  const context = await owner.newContext(options);
  const page = await context.newPage();
  return {
    page,
    close: async () => {
      await context.close();
      if (owner !== browser) await owner.close();
    },
  };
};

const checkDesktop = async (page: Page, data: Seed, engine: string, testInfo: TestInfo) => {
  await openRoom(page, data.roomId);
  await expectThreads(page, 'a room in room mode');
  await expect(roomViewSwitch(page)).toHaveAttribute('aria-pressed', 'false');
  for (const scheme of SCHEMES) {
    // eslint-disable-next-line no-await-in-loop
    await setLook(page, scheme);
    // eslint-disable-next-line no-await-in-loop
    await shot(page, testInfo, `thread-mode-${engine}-desktop-${scheme}`);
  }

  // A reply the reader watches arrive is read: the server's count for the room goes back to 0.
  await say(
    data.helper,
    data.roomId,
    'Update: the onboarding copy review moved to Wednesday afternoon.',
    undefined,
    AI_RUN
  );
  await expect(page.getByText('Update: the onboarding copy review moved').first()).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() => notificationCount(data.reader, data.roomId), {
      message: 'the watched reply is read',
      timeout: 20_000,
    })
    .toBe(0);

  // Without a chosen view the room follows the state while it is open.
  await setMode(data.router, data.roomId, 'thread');
  await expectCompact(page, 'after the mode became thread');
  await setMode(data.router, data.roomId, 'room');
  await expectThreads(page, 'after the mode became room again');

  // A chosen view wins over the state, now and after a reload.
  await roomViewSwitch(page).click();
  await expectCompact(page, 'after the reader chose Compact');
  await setMode(data.router, data.roomId, 'thread');
  await setMode(data.router, data.roomId, 'room');
  await page.waitForTimeout(1_500);
  await expectCompact(page, 'after the mode changed back to room');
  await page.reload();
  await expectCompact(page, 'after a reload');

  // "mixed" and a room without the state keep the Compact default.
  await openRoom(page, data.mixedRoomId);
  await expectCompact(page, 'a room in mixed mode');
  await openRoom(page, data.plainRoomId);
  await expectCompact(page, 'a room without the state');
};

for (const engine of ENGINES) {
  for (const form of ['desktop', 'phone'] as const) {
    test(`a room whose agents answer in the main timeline opens in Threads: ${engine} ${form}`, async ({
      browser,
    }, testInfo) => {
      test.skip(!(await disposableHomeserverIsUp()), 'Test homeserver is not running.');
      test.setTimeout(240_000);
      const data = await seed(`${engine}_${form}`);
      const { page, close } = await newPage(engine, browser, form === 'phone' ? PHONE : DESKTOP);
      try {
        await loginWithPassword(page, {
          homeserver: HOMESERVER,
          username: data.reader.username,
          password: PASSWORD,
        });
        if (form === 'desktop') {
          await checkDesktop(page, data, engine, testInfo);
        } else {
          await openRoom(page, data.roomId);
          await expectThreads(page, 'a room in room mode on a phone');
          for (const scheme of SCHEMES) {
            // eslint-disable-next-line no-await-in-loop
            await setLook(page, scheme);
            // eslint-disable-next-line no-await-in-loop
            await shot(page, testInfo, `thread-mode-${engine}-phone-${scheme}`);
          }
          await openRoom(page, data.plainRoomId);
          await expectCompact(page, 'a room without the state on a phone');
        }
      } finally {
        await close();
      }
    });
  }
}
