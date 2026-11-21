import {
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { COMPACT_VIEW } from '../helpers/compactCards';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Leaving a thread that was opened from a link (not from its card) brings its card into view in
// the Compact view, as leaving a thread opened from its card does. A room with an agent and 120
// threads, the linked one about 100 cards down the Last Reply order, among 25 rooms, with
// classic scrollbars, on a desktop (1280 by 800) and a phone (390 by 844, touch), in Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// COMPACT_EXIT_SHOTS to a directory to save the room after leaving.
const PASSWORD = 'compact-deep-link-exit-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.COMPACT_EXIT_SHOTS;
const ROOTS = 120;
const LINKED = 20;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const seed = async (label: string, mixedHeights = false) => {
  const reader = await registerDisposableUser(`cdl_reader_${label}_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `triage_${label}`);
  for (let index = 1; index <= 24; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  }
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Engineering triage',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootIds: string[] = [];
  for (let index = 1; index <= ROOTS; index += 1) {
    const title = mixedHeights
      ? `Ticket ${index}${
          index % 2 === 0
            ? ': Check why the nightly export stalled again after updating the report schema and moving the scheduled jobs to the next runner.'
            : ''
        }`
      : `Ticket ${index}: the nightly export for region ${
          index % 7
        } times out after the schema change.`;
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: title,
    });
    // Each thread's reply comes right after its root, so the Last Reply order keeps the room's.
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Looked at ticket ${index}: the export query needs the new index, patch is ready.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    rootIds.push(rootId);
  }
  return { reader, roomId, rootIds, linkedRootId: rootIds[LINKED - 1]! };
};

const cardShown = (page: Page, rootId: string) =>
  page.evaluate((id) => {
    const card = document.querySelector(`[data-thread-root-id="${CSS.escape(id)}"]`);
    if (!card) return false;
    const rect = card.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + Math.min(rect.width / 2, 120),
      rect.top + rect.height / 2
    );
    return !!hit && (card.contains(hit) || hit.contains(card));
  }, rootId);

const checkExit = async (page: Page, seeded: Awaited<ReturnType<typeof seed>>, label: string) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.reader.username,
    password: PASSWORD,
  });
  await page.goto(
    `/home/${encodeURIComponent(seeded.roomId)}?threadId=${encodeURIComponent(seeded.linkedRootId)}`
  );
  const banner = page.locator('[data-thread-context-banner]');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Looked at ticket ${LINKED}:`).first()).toBeVisible({
    timeout: 30_000,
  });
  await banner.getByRole('button').first().click();
  await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => cardShown(page, seeded.linkedRootId), {
      message: `the linked thread's card shows after leaving it (${label})`,
      timeout: 15_000,
    })
    .toBe(true);
  await page.waitForTimeout(1_500);
  expect(await cardShown(page, seeded.linkedRootId), `the card stays shown (${label})`).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}.png` });
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(form, () => {
    test.use(options);

    test(`leaving a linked thread shows its card in Compact (Chromium, ${form})`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const seeded = await seed(`c${form[0]}`);
      await checkExit(page, seeded, `chromium-${form}`);
    });

    test(`leaving a linked thread shows its card in Compact (WebKit, ${form})`, async ({
      baseURL,
    }) => {
      test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
      test.setTimeout(240_000);
      const seeded = await seed(`w${form[0]}`);
      // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
      const browser = await launchWebKit();
      try {
        const context = await browser.newContext({ ...options, baseURL });
        const page = await context.newPage();
        await checkExit(page, seeded, `webkit-${form}`);
      } finally {
        await browser.close();
      }
    });
  });
}

/** Sample visible cards over consecutive frames, without waiting for each window swap to settle. */
const measureReverseScroll = (view: Locator) =>
  view.evaluate(async (scroller) => {
    const bounds = scroller.getBoundingClientRect();
    const style = getComputedStyle(scroller);
    const bandTop = bounds.top + (parseFloat(style.scrollPaddingTop) || 0);
    const bandBottom = bounds.bottom - (parseFloat(style.scrollPaddingBottom) || 0);
    const read = () => ({
      scrollTop: scroller.scrollTop,
      cards: new Map(
        [
          ...scroller.querySelectorAll<HTMLElement>('button[data-thread-root-id]:not([inert] *)'),
        ].map((card) => [card.dataset.threadRootId!, card.getBoundingClientRect()] as const)
      ),
    });
    const deltaY = -64;
    const frames = 48;
    let before = read();
    const startScrollTop = before.scrollTop;
    const mountedAtSeek = new Set(before.cards.keys());
    const newVisibleHeights = new Map<string, number>();
    const offsets: number[] = [startScrollTop];
    let upFrames = 0;
    let framesWithoutAnchor = 0;
    let missingAnchors = 0;
    let worst = { drift: 0, frame: -1, id: '', delta: 0 };
    for (let frame = 0; frame <= frames; frame += 1) {
      if (frame < frames) {
        // Reader input with exact steps. The browser still dispatches the real scroll events.
        scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }));
        scroller.scrollTop += deltaY;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const after = read();
      const delta = after.scrollTop - before.scrollTop;
      offsets.push(after.scrollTop);
      if (delta < 0) upFrames += 1;
      let anchors = 0;
      before.cards.forEach((rect, id) => {
        // Use an anchor that was fully visible and would stay so if only scrolling moved it.
        if (
          rect.top < bandTop ||
          rect.bottom > bandBottom ||
          rect.top - delta < bandTop ||
          rect.bottom - delta > bandBottom
        )
          return;
        const next = after.cards.get(id);
        if (!next) {
          missingAnchors += 1;
          return;
        }
        anchors += 1;
        const drift = Math.abs(next.top - rect.top + delta);
        if (drift > worst.drift) worst = { drift, frame, id, delta };
      });
      if (anchors === 0) framesWithoutAnchor += 1;
      after.cards.forEach((rect, id) => {
        if (!mountedAtSeek.has(id) && rect.top >= bandTop && rect.bottom <= bandBottom) {
          newVisibleHeights.set(id, rect.height);
        }
      });
      before = after;
    }
    const heights = [...newVisibleHeights.values()];
    return {
      distance: startScrollTop - before.scrollTop,
      offsets,
      upFrames,
      framesWithoutAnchor,
      missingAnchors,
      newVisibleCards: heights.length,
      heightSpread: heights.length ? Math.max(...heights) - Math.min(...heights) : 0,
      worst,
    };
  });

const checkReverseScroll = async (
  baseURL: string | undefined,
  reducedMotion: 'no-preference' | 'reduce'
) => {
  const { reader, roomId, rootIds } = await seed(
    reducedMotion === 'reduce' ? 'reverse_reduced' : 'reverse',
    true
  );
  await onWebKitPage({ ...PHONE, baseURL, reducedMotion }, async (page) => {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const view = page.locator(COMPACT_VIEW);
    await expect(view).toHaveAttribute('data-compact-card-count', String(ROOTS), {
      timeout: 60_000,
    });
    const card = (id: string) => view.locator(`button[data-thread-root-id="${id}"]`);
    const early = card(rootIds.at(-1)!);
    const deep = card(rootIds[0]!);
    await expect(early).toBeInViewport();
    await expect(deep).toHaveCount(0);
    await early.focus();
    // Use the inset scrollbar's End handler without transferring focus off the early card.
    await view.getByRole('scrollbar').dispatchEvent('keydown', { key: 'End' });
    await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(5_000);
    await expect(deep).toHaveCount(1);
    await expect(early).toBeFocused();
    await expect(early).not.toBeInViewport();

    const result = await measureReverseScroll(view);
    test.info().annotations.push({ type: 'reverse scroll', description: JSON.stringify(result) });
    expect(result.distance, 'actual upward scroll distance').toBeGreaterThan(2_200);
    expect(
      result.upFrames,
      `frames with upward scrolling: ${result.offsets.join(', ')}`
    ).toBeGreaterThan(36);
    expect(result.newVisibleCards, 'newly mounted cards read on the way up').toBeGreaterThan(8);
    expect(result.heightSpread, 'short and tall cards in the new rows').toBeGreaterThan(8);
    expect(result.framesWithoutAnchor, 'frames without a shared visible anchor').toBe(0);
    expect(result.missingAnchors, 'visible cards unmounted during the scroll').toBe(0);
    expect(
      result.worst.drift,
      `max drift net of actual scroll: ${JSON.stringify(result.worst)}`
    ).toBeLessThan(1);
    await expect(early).toBeFocused();
  });
};

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  const mode = reducedMotion === 'reduce' ? ', reduced motion' : '';
  test(`reverse scrolling after a deep seek in mixed-height Compact cards (WebKit${mode})`, async ({
    baseURL,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(240_000);
    await checkReverseScroll(baseURL, reducedMotion);
  });
}
