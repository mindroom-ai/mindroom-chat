import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import { expectRoomCompact, toggleRoomView } from '../helpers/roomViewSwitch';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Leaving a thread opened from a link brings its root into view in the Threads view, whose newest
// thread is at the top, as it does in Compact: the view came back at its top and left the root
// about 1,000 px further down (live-test finding P2-lane4-F013). The room comes back in a window
// around the root, off the live end, and pages of newer history put threads above the reader
// after the jump: the root stays in view while they land. A room with an agent and 150 threads,
// the linked one 130 rows down and older than the first sync, among 25 rooms, with classic
// scrollbars; pages of newer history take 1.5 s, as on a slow connection. Desktop (1280 by 800)
// and phone (390 by 844, touch), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. Set THREADS_EXIT_SHOTS=<directory> for screenshots.
const PASSWORD = 'threads-view-deep-link-exit-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.THREADS_EXIT_SHOTS;
const TOPICS = 150;
const LINKED = 20;
const NEWER_PAGE_DELAY_MS = 1_500;
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.setTimeout(240_000);
});

const topic = (index: number) =>
  `Lobby topic ${index}: plan the quarterly offsite agenda, with the venue shortlist and budget`;

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

const seed = async (label: string) => {
  // A repeated test (--repeat-each) runs in the same worker, with the same RUN.
  const suffix = `${label}_${RUN}${test.info().repeatEachIndex}`;
  const reader = await registerDisposableUser(`tvx_reader_${suffix}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `lobby_${suffix}`);
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Lobby',
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
    // Each reply follows its root, so the Last Reply order, newest first, is the reverse of it.
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Noted topic ${index}; I collected the options in a short list for the team to review.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    if (index === LINKED) linkedRootId = rootId;
  }
  return { reader, roomId, linkedRootId };
};

const rootShownAfterExit = async (page: Page, label: string) => {
  const { reader, roomId, linkedRootId } = await seed(label);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  // A room with an agent opens in Compact; the reader picks the Threads view, which the room keeps.
  await expectRoomCompact(page, true, 60_000);
  await toggleRoomView(page);
  await expectRoomCompact(page, false);
  await expect.poll(() => rowShown(page, topic(TOPICS)), { timeout: 30_000 }).toBe(true);

  // A link to the root opens its thread; its banner's back button leaves it.
  await page.goto(`/home/${encodeURIComponent(roomId)}/${encodeURIComponent(linkedRootId)}`);
  const banner = page.locator('[data-thread-context-banner]');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Noted topic ${LINKED};`).first()).toBeVisible({ timeout: 30_000 });
  // Pages of newer history arrive late, after the jump to the root has come to rest.
  await page.route(
    (url) => url.pathname.endsWith('/messages') && url.searchParams.get('dir') === 'f',
    async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, NEWER_PAGE_DELAY_MS);
      });
      await route.continue();
    }
  );
  await banner.getByRole('button').first().click();
  await expect(banner).toHaveCount(0, { timeout: 20_000 });
  await expectRoomCompact(page, false, 20_000);
  await expect
    .poll(() => rowShown(page, topic(LINKED)), {
      message: `the linked root shows after leaving its thread (${label})`,
      timeout: 15_000,
    })
    .toBe(true);
  // It stays while the newer pages land: nothing hands the view to other threads.
  await page.waitForTimeout(NEWER_PAGE_DELAY_MS + 2_500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/threads-exit-${label}.png` });
  expect(await rowShown(page, topic(LINKED)), `the root stays shown (${label})`).toBe(true);
};

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(form, () => {
    test.use(options);

    test(`leaving a linked thread shows its root in the Threads view (Chromium ${form})`, async ({
      page,
    }) => {
      await rootShownAfterExit(page, `c${form[0]}`);
    });

    test(`leaving a linked thread shows its root in the Threads view (WebKit ${form})`, async ({
      baseURL,
    }) => {
      test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      await onWebKitPage({ ...options, baseURL }, (page) =>
        rootShownAfterExit(page, `w${form[0]}`)
      );
    });
  });
}
