import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { buildBusyThreadRoom, send, type BusyThreadRoom } from '../helpers/busyThreadRoom';
import { DISPOSABLE_HOMESERVER, disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import { createDefaultThreadFilterState, seedRoomOverviewState } from '../helpers/matrix';

/**
 * A tap on the iOS status bar scrolls the view to its top, as in every iOS app. The app gets the
 * tap as Capacitor's `statusTap` window event, which the spec sends itself. Compact and Threads
 * open at their top, newest first, so the reader scrolls down first; Classic and an open thread
 * open at their newest row at the bottom. The view must reach its top and stay there (Classic and
 * the thread load older rows from there, which keep the reader where they are), not be pulled back
 * to the row it opened at. A phone (390 by 844, a finger) and a desktop (1280 by 800), Chromium,
 * against the disposable homeserver.
 */

const PASSWORD = 'status-bar-tap-password';
const REPLIES = 60;

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1280, height: 800 } },
} as const;

test.use({ trace: 'off', video: 'off' });

type World = BusyThreadRoom & { longRootId: string };
let world: World | undefined;

test.beforeAll(async () => {
  test.setTimeout(5 * 60_000);
  if (!(await disposableHomeserverIsUp())) return;
  const room = await buildBusyThreadRoom({ threads: 40, otherRooms: 0, password: PASSWORD });
  const longRootId = await send(room.peer, room.roomId, 'm.room.message', {
    msgtype: 'm.text',
    body: `The release checklist, step by step (${randomUUID().slice(0, 6)})`,
  });
  let previous = longRootId;
  for (let index = 1; index <= REPLIES; index += 1) {
    const sender = index % 2 === 0 ? room.reader : room.peer;
    // eslint-disable-next-line no-await-in-loop
    previous = await send(sender, room.roomId, 'm.room.message', {
      msgtype: 'm.text',
      body: `Step ${index}: checked the build, the notes and the rollout plan for region ${index}.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: longRootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: previous },
      },
    });
  }
  world = { ...room, longRootId };
});

/**
 * The view's scroll area: the outermost area around the first element `rows` finds that scrolls
 * (a group of rows can scroll inside it).
 */
const scrollArea = (page: Page, rows: string) =>
  page.evaluateHandle((selector) => {
    let area: HTMLElement | undefined;
    for (let node = document.querySelector(selector); node; node = node.parentElement) {
      if (
        node instanceof HTMLElement &&
        ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) &&
        node.scrollHeight > node.clientHeight + 1
      )
        area = node;
    }
    if (!area) throw new Error(`No scroll area around ${selector}`);
    return area;
  }, rows);

/** The scroll offset of the view and how far it can scroll. */
const offsetAround = async (page: Page, rows: string) =>
  (await scrollArea(page, rows)).evaluate((area) => ({
    top: area.scrollTop,
    room: area.scrollHeight - area.clientHeight,
  }));

/** Sends the tap; returns the view's scroll offset right after it, before older rows can load. */
const tapStatusBar = async (page: Page, rows: string) =>
  (await scrollArea(page, rows)).evaluate((area) => {
    window.dispatchEvent(new Event('statusTap'));
    return area.scrollTop;
  });

/** The area's scroll offset every 200 ms for two seconds. */
const sampleOffsets = async (page: Page, rows: string) => {
  const samples: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(200);
    // eslint-disable-next-line no-await-in-loop
    samples.push((await offsetAround(page, rows)).top);
  }
  return samples;
};

/** The peer sends `count` messages to the room, one every 400 ms. */
const keepSending = async (room: World, count: number, rootId?: string) => {
  for (let index = 0; index < count; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(room.peer, room.roomId, 'm.room.message', {
      msgtype: 'm.text',
      body: `Live note ${index}: still watching the rollout.`,
      ...(rootId
        ? { 'm.relates_to': { rel_type: 'm.thread', event_id: rootId, is_falling_back: true } }
        : {}),
    });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
};

const ROWS = {
  compact: '[data-compact-room-view="true"] [data-scroll-anchor]',
  threaded: '[data-message-item]',
  classic: '[data-message-id]',
} as const;

for (const [name, options] of Object.entries(VIEWPORTS)) {
  test.describe(`${name}: a status bar tap`, () => {
    test.use(options);
    test.setTimeout(4 * 60_000);

    test.beforeEach(async ({ page }) => {
      test.skip(!world, `No homeserver at ${DISPOSABLE_HOMESERVER}`);
      await loginWithPassword(page, {
        homeserver: DISPOSABLE_HOMESERVER,
        username: world!.reader.username,
        password: PASSWORD,
      });
    });

    for (const view of ['compact', 'threaded', 'classic'] as const) {
      test(`scrolls the ${view} view to its top`, async ({ page }) => {
        const room = world!;
        await seedRoomOverviewState({
          page,
          roomId: room.roomId,
          userId: room.reader.userId,
          viewMode: view,
          filterState: createDefaultThreadFilterState(),
        });
        await page.goto(`/home/${encodeURIComponent(room.roomId)}`);
        const rows = ROWS[view];
        await expect(page.locator(rows).first()).toBeVisible({ timeout: 120_000 });
        await page.waitForTimeout(2_000);
        if (view !== 'classic') {
          // Newest first: the view opens at its top, so the reader scrolls down into history.
          const box = await (await scrollArea(page, rows)).boundingBox();
          await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
          await expect(async () => {
            await page.mouse.wheel(0, 800);
            expect((await offsetAround(page, rows)).top).toBeGreaterThan(1_500);
          }).toPass({ timeout: 30_000 });
          await page.waitForTimeout(1_000);
        }
        const before = await offsetAround(page, rows);
        expect(before.top, 'the reader is away from the top').toBeGreaterThan(300);

        // In Classic, messages keep arriving while the reader is at the newest row, which holds a
        // reader there; the tap must still take them up.
        const arrivals = view === 'classic' ? keepSending(room, 6) : Promise.resolve();
        if (view === 'classic') await page.waitForTimeout(700);
        expect(await tapStatusBar(page, rows), 'scroll offset right after the tap').toBe(0);

        const after = await sampleOffsets(page, rows);
        await arrivals;
        if (view === 'classic') {
          // Older rows load at the top and keep the reader on the rows they saw: never back at
          // the newest row.
          const away = await offsetAround(page, rows);
          expect(away.room - away.top, 'distance from the newest row').toBeGreaterThan(300);
        } else {
          expect(after, 'scroll offset after the tap').toEqual(after.map(() => 0));
        }
      });
    }

    test('scrolls an open thread up to its first reply', async ({ page }) => {
      const room = world!;
      await seedRoomOverviewState({
        page,
        roomId: room.roomId,
        userId: room.reader.userId,
        viewMode: 'threaded',
        filterState: createDefaultThreadFilterState(),
      });
      await page.goto(
        `/home/${encodeURIComponent(room.roomId)}?threadId=${encodeURIComponent(room.longRootId)}`
      );
      const last = page.getByText(`Step ${REPLIES}: checked the build`);
      await expect(last).toBeVisible({ timeout: 120_000 });
      await page.waitForTimeout(2_000);
      const first = page.getByText('Step 1: checked the build', { exact: false });
      // Replies keep arriving at the bottom, where the thread holds a reader who is there.
      const arrivals = keepSending(room, 8, room.longRootId);
      await page.waitForTimeout(700);
      // Each tap reaches the top of the replies loaded so far; older ones load from there.
      await expect(async () => {
        await tapStatusBar(page, '[data-message-id]');
        await expect(first).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 60_000 });
      await arrivals;
      await page.waitForTimeout(1_500);
      await expect(first, 'the thread stays at its first replies').toBeInViewport();
    });
  });
}
