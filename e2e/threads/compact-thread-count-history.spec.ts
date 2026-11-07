import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  joinRoom,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { onWebKitPage } from '../helpers/webkit';

// The Compact view's thread count stays the same as history loads. Messages nobody answered show
// as cards once their part of the history loads, and the count took them in: 461 on opening, 500
// at the end of the cards, 462 after a reload, with nothing changed on the server (live-test
// finding P2-lane4-F005). It now counts the room's threads, which the server lists in full. A room
// with an agent, 30 threads and 12 older unanswered messages, on a desktop in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// THREAD_COUNT_SHOTS=<directory> for screenshots.
const PASSWORD = 'compact-thread-count-history-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.THREAD_COUNT_SHOTS;
const THREADS = 30;
const UNANSWERED = 12;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const question = (index: number) => `Unanswered question ${index}: who owns the VPN renewal?`;

const shownCount = async (page: Page) =>
  Number((await page.locator('[data-thread-count="true"]').first().innerText()).trim());

const countStays = async (page: Page, label: string) => {
  const reader = await registerDisposableUser(`ctch_reader_${label}_${RUN}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_ops_${label}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Ops desk ${label}`,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  for (let index = 1; index <= UNANSWERED; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: question(index),
    });
  }
  for (let index = 1; index <= THREADS; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Ticket ${index}: rotate the staging certificates for service ${index}.`,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Rotated the certificates for service ${index}.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }
  // A new question in the newest messages.
  await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Fresh question: is the change freeze still on for Friday?',
  });

  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const count = page.locator('[data-thread-count="true"]').first();
  await expect(count).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => shownCount(page), { timeout: 30_000 }).toBe(THREADS);

  // The end of the cards loads the history with the older questions.
  const oldest = page.getByText(question(1), { exact: true }).first();
  const firstCard = await page.locator('[data-thread-root-id]').first().boundingBox();
  if (firstCard) await page.mouse.move(firstCard.x + firstCard.width / 2, firstCard.y + 20);
  for (let step = 0; step < 40 && !(await oldest.isVisible()); step += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => {
      const card = document.querySelector('[data-thread-root-id]');
      let scroller = card?.parentElement ?? null;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
        scroller = scroller.parentElement;
      }
      scroller?.scrollTo({ top: scroller.scrollHeight });
    });
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.wheel(0, 1_200);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(400);
  }
  await expect(oldest, 'the oldest question loaded as a card').toBeVisible({ timeout: 15_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/thread-count-${label}-end.png` });
  expect(await shownCount(page), 'the count at the end of the cards').toBe(THREADS);

  await page.reload();
  await expect(count).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => shownCount(page), { timeout: 30_000 }).toBe(THREADS);
};

test('the Compact thread count stays as history loads (Chromium)', async ({ page }) => {
  test.setTimeout(240_000);
  await countStays(page, 'chromium');
});

test('the Compact thread count stays as history loads (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    countStays(page, 'webkit')
  );
});
