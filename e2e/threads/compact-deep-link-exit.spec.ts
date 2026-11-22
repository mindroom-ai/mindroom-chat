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
import {
  createDefaultThreadFilterState,
  joinRoom,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { toggleRoomView } from '../helpers/roomViewSwitch';
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
const measureReverseScroll = (view: Locator, throughTop: boolean) =>
  view.evaluate(async (scroller, toTop) => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    const writes: number[] = [];
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => Number(descriptor.get?.call(scroller)),
      set: (value: number) => {
        writes.push(value);
        descriptor.set?.call(scroller, value);
      },
    });
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
    let before = read();
    const startScrollTop = before.scrollTop;
    const frames = toTop ? Math.ceil(startScrollTop / -deltaY) : 48;
    const mountedAtSeek = new Set(before.cards.keys());
    const newVisibleHeights = new Map<string, number>();
    const offsets: number[] = [startScrollTop];
    let upFrames = 0;
    let worstStep = 0;
    let framesWithoutAnchor = 0;
    let missingAnchors = 0;
    let worst = { drift: 0, frame: -1, id: '', delta: 0 };
    for (let frame = 0; frame <= frames; frame += 1) {
      if (frame < frames) {
        scroller.scrollTop += deltaY;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const after = read();
      const delta = after.scrollTop - before.scrollTop;
      // The browser moved by what was asked: a block swap that clamps the offset moves it further.
      const asked = frame < frames ? Math.max(0, before.scrollTop + deltaY) : before.scrollTop;
      worstStep = Math.max(worstStep, Math.abs(after.scrollTop - asked));
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
    Reflect.deleteProperty(scroller, 'scrollTop');
    return {
      frames,
      writes,
      distance: startScrollTop - before.scrollTop,
      offsets,
      upFrames,
      worstStep,
      framesWithoutAnchor,
      missingAnchors,
      newVisibleCards: heights.length,
      heightSpread: heights.length ? Math.max(...heights) - Math.min(...heights) : 0,
      worst,
    };
  }, throughTop);

const checkReverseScroll = async (
  baseURL: string | undefined,
  reducedMotion: 'no-preference' | 'reduce',
  throughTop = false
) => {
  const { reader, roomId, rootIds } = await seed(
    throughTop ? 'reverse_top' : reducedMotion === 'reduce' ? 'reverse_reduced' : 'reverse',
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
    await expect(view).not.toHaveAttribute('data-cards-pending', 'true', { timeout: 30_000 });
    await expect(early).toBeInViewport();
    await expect(deep).toHaveCount(0);
    await early.focus();
    // Use the inset scrollbar's End handler without transferring focus off the early card.
    await view.getByRole('scrollbar').dispatchEvent('keydown', { key: 'End' });
    await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(5_000);
    await expect(deep).toHaveCount(1);
    await expect(early).toBeFocused();
    await expect(early).not.toBeInViewport();

    const result = await measureReverseScroll(view, throughTop);
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
    expect(result.writes, 'only the reader scrolls during block swaps').toHaveLength(result.frames);
    expect(
      result.worstStep,
      `each frame lands where it was asked to: ${result.offsets.join(', ')}`
    ).toBeLessThan(1);
    if (throughTop) expect(result.offsets.slice(-2)).toEqual([0, 0]);
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

test('reverse scrolling reaches native zero through its first idle paint (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await checkReverseScroll(baseURL, 'no-preference', true);
});

// After a width change the cards outside the window keep their cached heights until they mount.
// End must read the extent with the real end mounted, in its one scroll write.
test('scrollbar End reaches the real end after the cards below grew (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const { reader, roomId, rootIds } = await seed('resized_end', true);
  // Wide enough for the long titles to take one line; narrowed below, they take two.
  await onWebKitPage({ viewport: { width: 1800, height: 800 }, baseURL }, async (page) => {
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
    await expect(view).not.toHaveAttribute('data-cards-pending', 'true', { timeout: 30_000 });
    const frames = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          })
      );
    const extent = () => view.evaluate((el) => el.scrollHeight - el.clientHeight);
    await view.evaluate((el) => {
      el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.4;
    });
    await frames();
    const wide = await extent();
    await page.setViewportSize({ width: 1000, height: 800 });
    await frames();
    await frames();
    const last = view.locator(`button[data-thread-root-id="${rootIds[0]!}"]`);
    await expect(last).toHaveCount(0);
    const end = await view.evaluate((scroller) => {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
      const writes: number[] = [];
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => Number(descriptor.get?.call(scroller)),
        set: (value: number) => {
          writes.push(value);
          descriptor.set?.call(scroller, value);
        },
      });
      const before = scroller.scrollHeight - scroller.clientHeight;
      const bar = scroller.querySelector<HTMLElement>('[role="scrollbar"]')!;
      bar.focus({ preventScroll: true });
      bar.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })
      );
      const result = {
        before,
        writes,
        scrollTop: scroller.scrollTop,
        maximum: scroller.scrollHeight - scroller.clientHeight,
      };
      return new Promise<typeof result & { settledTop: number; settledMaximum: number }>(
        (resolve) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              Reflect.deleteProperty(scroller, 'scrollTop');
              resolve({
                ...result,
                settledTop: scroller.scrollTop,
                settledMaximum: scroller.scrollHeight - scroller.clientHeight,
              });
            })
          );
        }
      );
    });
    test.info().annotations.push({ type: 'resized end', description: JSON.stringify(end) });
    expect(wide, 'the list had a deep scroll range at the wide width').toBeGreaterThan(3_000);
    expect(
      end.settledMaximum - end.before,
      'the cards below the reader were taller than their cached heights'
    ).toBeGreaterThan(100);
    expect(end.writes, 'End writes the offset once').toHaveLength(1);
    expect(Math.abs(end.scrollTop - end.maximum), 'End lands on the real end').toBeLessThanOrEqual(
      1
    );
    expect(
      Math.abs(end.settledTop - end.settledMaximum),
      'and the end stays the end once the window has settled'
    ).toBeLessThanOrEqual(1);
    await expect(last).toBeInViewport();
  });
});

test('scrollbar End during discovery reaches the available end (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const { reader, roomId } = await seed('immediate_end', true);
  await onWebKitPage({ ...PHONE, baseURL }, async (page) => {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({
      page,
      userId: reader.userId,
      roomId,
      viewMode: 'threaded',
      filterState: createDefaultThreadFilterState(),
    });
    await page.addInitScript(
      ({ selector, total }) => {
        const observer = new MutationObserver(() => {
          const view = document.querySelector<HTMLElement>(selector);
          const bar = view?.querySelector<HTMLElement>('[role="scrollbar"]');
          if (
            !bar ||
            view?.dataset.compactCardCount !== total ||
            view.dataset.cardsPending !== 'true' ||
            bar.dataset.overflow !== 'true' ||
            Number(bar.getAttribute('aria-valuemax')) <= 0
          )
            return;
          observer.disconnect();
          bar.focus({ preventScroll: true });
          bar.dataset.endAt = String(view.scrollHeight - view.clientHeight);
          bar.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })
          );
          bar.dataset.endReadback = String(view.scrollTop);
        });
        observer.observe(document, { childList: true, subtree: true, attributes: true });
      },
      { selector: COMPACT_VIEW, total: String(ROOTS) }
    );
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const view = page.locator(COMPACT_VIEW);
    await expect(view).toHaveCount(0);
    // Warm the index in Threads first, then mount Compact with all 120 roots already listed.
    const overview = page.locator('[data-room-thread-overview]');
    const openMenu = () =>
      page.getByRole('button', { name: 'More Options', exact: true }).last().tap();
    const filters = page.getByRole('menuitemcheckbox', { name: 'Thread filters', exact: true });
    await page.getByRole('heading', { name: 'Engineering triage' }).waitFor({ timeout: 30_000 });
    if (!(await overview.isVisible())) {
      await openMenu();
      await filters.tap();
    }
    await expect(overview.locator('[data-thread-count]')).toHaveText(String(ROOTS), {
      timeout: 30_000,
    });
    await openMenu();
    await filters.tap();
    await expect(overview).toBeHidden();
    await toggleRoomView(page);
    const bar = view.getByRole('scrollbar');
    await expect(bar).toHaveAttribute('data-end-readback', /^\d/, { timeout: 15_000 });
    const availableEnd = Number(await bar.getAttribute('data-end-at'));
    const readback = Number(await bar.getAttribute('data-end-readback'));
    expect(
      Math.abs(readback - availableEnd),
      'End acts during the key event, even while pending'
    ).toBeLessThanOrEqual(1);
    await expect(view).not.toHaveAttribute('data-cards-pending', 'true', { timeout: 30_000 });
    // Main stays at the end available when End was pressed, not at the newly grown tail.
    // The aabc4e009 control reached 1682 CSS px with this fixture/viewport.
    const settledTop = await view.evaluate((el) => el.scrollTop);
    expect(settledTop).toBeGreaterThanOrEqual(Math.max(1682, availableEnd) - 1);
    await expect(bar).toBeFocused();
  });
});
