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

// Back from a thread the reader opened from the Threads view, newest first, brings the list back
// where they left it, with the thread's row where it was: the view came back at its top, the
// newest thread, and left the row 2,000 to 4,500 px further down (live-test finding
// P3-lane4-F101). A room with an agent and 120 threads, among 25 rooms, with classic scrollbars;
// the reader scrolls down about 30 threads (the mouse wheel on a desktop, the scroll position on
// a phone), opens a thread from its reply chip and presses the banner's back button. Desktop
// (1280 by 800) and phone (390 by 844, touch), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// THREADS_BACK_SHOTS=<directory> for screenshots.
const PASSWORD = 'threads-view-back-keeps-place-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.THREADS_BACK_SHOTS;
const TOPICS = 120;
const OPENED = 90;
// How far the row may sit from where it was: a row above it that measures again moves it a bit.
const PLACE_TOLERANCE_PX = 24;
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

const seed = async (label: string) => {
  // A repeated test (--repeat-each) runs in the same worker, with the same RUN.
  const suffix = `${label}_${RUN}${test.info().repeatEachIndex}`;
  const reader = await registerDisposableUser(`tvb_reader_${suffix}`, PASSWORD);
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
  }
  return { reader, roomId };
};

/**
 * The room timeline's scroll position and the top of the row holding `text` relative to the
 * scroll area's top (null when it shows nowhere on screen, or sits under another layer).
 */
const rowPlace = (page: Page, text: string) =>
  page.evaluate((needle) => {
    const inner = document.querySelector('[data-testid="room-virtual-inner"]');
    let scroller = inner?.parentElement ?? null;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
      scroller = scroller.parentElement;
    }
    const area = scroller?.getBoundingClientRect();
    const row = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].find((element) =>
      element.textContent?.includes(needle)
    );
    const rect = row?.getBoundingClientRect();
    const x = rect ? rect.left + Math.min(rect.width / 2, 160) : 0;
    const shown =
      !!row &&
      !!rect &&
      [rect.top + 8, rect.top + rect.height / 2, rect.bottom - 8].some((y) => {
        if (y < 0 || y > window.innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return !!hit && row.contains(hit);
      });
    return {
      scrollTop: Math.round(scroller?.scrollTop ?? -1),
      top: shown && rect && area ? Math.round(rect.top - area.top) : null,
    };
  }, text);

/** Scrolls the Threads view down, as the reader does, until the row holding `text` shows. */
const scrollDownTo = async (page: Page, text: string, phone: boolean) => {
  for (let step = 0; step < 80; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    const place = await rowPlace(page, text);
    // Somewhere in the upper half, so the reply chip below it shows too.
    if (place.top !== null && place.top > 40 && place.top < 300) return place;
    if (phone) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(() => {
        const inner = document.querySelector('[data-testid="room-virtual-inner"]');
        let scroller = inner?.parentElement ?? null;
        while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
          scroller = scroller.parentElement;
        }
        scroller?.scrollBy({ top: 120 });
      });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, 120);
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(120);
  }
  throw new Error(
    `"${text}" never showed in the upper half: ${JSON.stringify(await rowPlace(page, text))}`
  );
};

const backKeepsPlace = async (page: Page, label: string, phone: boolean) => {
  const { reader, roomId } = await seed(label);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  // A room with an agent opens in Compact; the reader picks the Threads view, which the room keeps.
  await expectRoomCompact(page, true, 60_000);
  await toggleRoomView(page);
  await expectRoomCompact(page, false);
  await expect
    .poll(async () => (await rowPlace(page, topic(TOPICS))).top !== null, { timeout: 30_000 })
    .toBe(true);

  if (!phone) {
    const area = page.locator('[data-testid="room-virtual-inner"]');
    const box = await area.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + 200);
  }
  await scrollDownTo(page, topic(OPENED), phone);
  // Rows measure as they mount: read the place once the view rests.
  await page.waitForTimeout(800);
  const before = await rowPlace(page, topic(OPENED));
  expect(before.top, `the row shows before opening its thread (${label})`).not.toBeNull();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/threads-back-${label}-1-before.png` });

  const row = page.locator('[data-message-id]').filter({ hasText: topic(OPENED) });
  const chip = row.getByRole('button', { name: /1 reply/ }).first();
  if (phone) await chip.tap();
  else await chip.click();
  const banner = page.locator('[data-thread-context-banner]');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Noted topic ${OPENED};`).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).not.toBeNull();

  const back = banner.getByRole('button').first();
  if (phone) await back.tap();
  else await back.click();
  await expect(banner).toHaveCount(0, { timeout: 20_000 });
  await expectRoomCompact(page, false, 20_000);
  expect(new URL(page.url()).searchParams.get('threadId')).toBeNull();

  const near = (place: { top: number | null }) =>
    place.top !== null && Math.abs(place.top - (before.top ?? 0)) <= PLACE_TOLERANCE_PX;
  await expect
    .poll(async () => rowPlace(page, topic(OPENED)), {
      message: `the thread's row is back where it was after Back (${label}): ${JSON.stringify(
        before
      )}`,
      timeout: 15_000,
    })
    .toMatchObject({ top: expect.any(Number) });
  const after = await rowPlace(page, topic(OPENED));
  expect(
    near(after),
    `the row sits where it was (${label}): ${JSON.stringify({ before, after })}`
  ).toBe(true);
  // It stays there: nothing sends the view to the newest thread afterwards.
  await page.waitForTimeout(2_500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/threads-back-${label}-2-after.png` });
  const settled = await rowPlace(page, topic(OPENED));
  expect(
    near(settled),
    `the row stays where it was (${label}): ${JSON.stringify({ before, settled })}`
  ).toBe(true);
};

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(form, () => {
    test.use(options);

    test(`Back from a thread keeps the Threads view's place (Chromium ${form})`, async ({
      page,
    }) => {
      await backKeepsPlace(page, `c${form[0]}`, form === 'phone');
    });

    test(`Back from a thread keeps the Threads view's place (WebKit ${form})`, async ({
      baseURL,
    }) => {
      test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      await onWebKitPage({ ...options, baseURL }, (page) =>
        backKeepsPlace(page, `w${form[0]}`, form === 'phone')
      );
    });
  });
}
