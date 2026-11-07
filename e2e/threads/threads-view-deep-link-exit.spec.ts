import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, sendRoomMessage } from '../helpers/matrix';
import { expectRoomCompact, toggleRoomView } from '../helpers/roomViewSwitch';
import { onWebKitPage } from '../helpers/webkit';

// Leaving a thread opened from a link brings its root into view in the Threads view, whose newest
// thread is at the top, as it does in Compact: the view opened at its top and left the root about
// 1,000 px further down (live-test finding P2-lane4-F013). A room with an agent and 30 threads,
// the linked one 25 rows down, on a desktop (1280 by 800) in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, on a phone in WebKit. Set
// THREADS_EXIT_SHOTS=<directory> for screenshots.
const PASSWORD = 'threads-view-deep-link-exit-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.THREADS_EXIT_SHOTS;
const TOPICS = 30;
const LINKED = 6;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const topic = (index: number) => `Lobby topic ${index}: plan the quarterly offsite agenda`;

/** Whether a row holding `text` shows on screen, not under another layer. */
const rowShown = (page: Page, text: string) =>
  page.evaluate((needle) => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].filter((row) =>
      row.textContent?.includes(needle)
    );
    return rows.some((row) => {
      const rect = row.getBoundingClientRect();
      const x = rect.left + Math.min(rect.width / 2, 160);
      return [rect.top + 8, rect.top + rect.height / 2, rect.bottom - 8].some((y) => {
        if (y < 0 || y > window.innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return !!hit && row.contains(hit);
      });
    });
  }, text);

const rootShownAfterExit = async (page: Page, label: string) => {
  const reader = await registerDisposableUser(`tvx_reader_${label}_${RUN}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_host_${label}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Lobby ${label}`,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  let linkedRootId = '';
  for (let index = 1; index <= TOPICS; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: topic(index),
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Noted topic ${index}; I collected the options in a short list.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    if (index === LINKED) linkedRootId = rootId;
  }

  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  // A room with an agent opens in Compact; the reader picks the Threads view.
  await expectRoomCompact(page, true);
  await toggleRoomView(page);
  await expectRoomCompact(page, false);
  await expect.poll(() => rowShown(page, topic(TOPICS)), { timeout: 30_000 }).toBe(true);

  // A link to the root opens its thread; its banner's back button leaves it.
  await page.goto(`/home/${encodeURIComponent(roomId)}/${encodeURIComponent(linkedRootId)}`);
  const banner = page.locator('[data-thread-context-banner]');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Noted topic ${LINKED};`).first()).toBeVisible({ timeout: 30_000 });
  await banner.getByRole('button').first().click();
  await expectRoomCompact(page, false, 20_000);
  await expect
    .poll(() => rowShown(page, topic(LINKED)), {
      message: `the linked root shows after leaving its thread (${label})`,
      timeout: 15_000,
    })
    .toBe(true);
  // It stays: nothing hands the view back to the newest threads.
  await page.waitForTimeout(1_500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/threads-exit-${label}.png` });
  expect(await rowShown(page, topic(LINKED)), `the root stays shown (${label})`).toBe(true);
};

test('leaving a linked thread shows its root in the Threads view (Chromium)', async ({ page }) => {
  test.setTimeout(240_000);
  await rootShownAfterExit(page, 'chromium');
});

test('leaving a linked thread shows its root in the Threads view (WebKit phone)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await onWebKitPage(
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL },
    (page) => rootShownAfterExit(page, 'webkit')
  );
});
