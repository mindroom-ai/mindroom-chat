import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// While a ResizeObserver row-report commit holds virtualInnerRef's height to avoid ResizeObserver
// loop errors on contentRef's observers, exposing net growth outside contentRef keeps scrollHeight
// accurate before paint on Path A (overscan row grows) and Path B (in-view row grows under the
// opening pin), while leaving post-gesture expansion unfolding in place.
const PASSWORD = 'thread-held-growth-flicker-password';
const RUN = Date.now().toString(36);
const REPLY_COUNT = 24;
const LOOP_ERROR = /ResizeObserver loop/;
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

type World = { reader: DisposableUser; roomId: string; rootId: string };
type Sample = {
  postCommit: boolean;
  newestBottom: number;
  scrollTop: number;
  gapAfterTarget: number | null;
};
type GrowthResult = {
  baselineNewestBottom: number;
  baselineScrollTop: number;
  baselineScrollHeight: number;
  targetGrowthPx: number;
  finalScrollTop: number;
  finalScrollHeight: number;
  finalBottomGap: number;
  finalNewestBottom: number;
  finalGapAfterTarget: number | null;
  sawCommit: boolean;
  samples: Sample[];
};

const seed = async (): Promise<World> => {
  const reader = await registerDisposableUser(`thgf_reader_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, { name: 'Harbor Log' });
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Harbor log thread root\nRoutine tide and berth notes for the evening watch.',
  });
  let lastId = rootId;
  for (let index = 1; index <= REPLY_COUNT; index += 1) {
    lastId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Harbor log entry ${index}\nBerth ${index} reported calm water and steady lines.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: lastId },
      },
    });
  }
  return { reader, roomId, rootId };
};

const readLoopErrors = async (page: Page, pageErrors: string[]): Promise<string[]> => {
  const windowLoops = await page.evaluate(
    () => (window as unknown as { resizeLoops?: string[] }).resizeLoops ?? []
  );
  return [...windowLoops, ...pageErrors.filter((message) => LOOP_ERROR.test(message))];
};

const waitFrames = (page: Page, count: number) =>
  page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let remaining = frames;
        const tick = () => {
          remaining -= 1;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count
  );

const mutateAndSampleGrowth = (
  page: Page,
  options: { kind: 'above-viewport' | 'in-view'; deltaPx: number; frames: number }
): Promise<GrowthResult> =>
  page.evaluate(({ kind, deltaPx, frames }) => {
    const rows = document.querySelector<HTMLElement>('[data-thread-count]');
    const scroller = rows?.parentElement?.parentElement;
    if (!rows || !scroller) throw new Error('Thread scroller not found');
    const tiles = Array.from(rows.querySelectorAll<HTMLElement>(':scope > [data-index]'))
      .filter((tile) => tile.offsetHeight > 0)
      .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
    const newestTile = tiles[tiles.length - 1];
    if (!newestTile) throw new Error('Newest thread tile not found');
    const newestIndex = Number(newestTile.dataset.index);
    const scrollerRect = scroller.getBoundingClientRect();
    const newestTop = newestTile.getBoundingClientRect().top;

    const candidates = tiles.filter((tile) => {
      const index = Number(tile.dataset.index);
      if (index >= newestIndex || tile.querySelector('[data-e2e-growth]')) return false;
      const rect = tile.getBoundingClientRect();
      const start = Number.parseFloat(tile.style.top);
      return kind === 'above-viewport'
        ? rect.bottom < scrollerRect.top - 20 && start + tile.offsetHeight <= scroller.scrollTop
        : start > scroller.scrollTop &&
            rect.top >= scrollerRect.top + 80 &&
            rect.bottom <= newestTop + 1;
    });
    const target =
      kind === 'above-viewport'
        ? candidates[candidates.length - 1]
        : candidates[Math.floor(candidates.length / 2)];
    if (!target) throw new Error(`No ${kind} target tile found`);
    const nextTile = rows.querySelector<HTMLElement>(
      `:scope > [data-index="${Number(target.dataset.index) + 1}"]`
    );

    const baselineNewestBottom = newestTile.getBoundingClientRect().bottom;
    const baselineScrollTop = scroller.scrollTop;
    const baselineScrollHeight = scroller.scrollHeight;
    const baselineTargetHeight = target.getBoundingClientRect().height;
    const samples: Sample[] = [];
    let sawCommit = false;

    const record = () => {
      samples.push({
        postCommit: sawCommit,
        newestBottom: newestTile.getBoundingClientRect().bottom,
        scrollTop: scroller.scrollTop,
        gapAfterTarget: nextTile
          ? nextTile.getBoundingClientRect().top - target.getBoundingClientRect().bottom
          : null,
      });
    };
    const observer = new MutationObserver(() => {
      sawCommit = true;
      record();
    });
    observer.observe(rows, { attributes: true, attributeFilter: ['style'], subtree: true });

    return new Promise<GrowthResult>((resolve) => {
      requestAnimationFrame(() => {
        const growth = document.createElement('div');
        growth.dataset.e2eGrowth = 'true';
        growth.style.height = `${deltaPx}px`;
        growth.style.flexShrink = '0';
        target.appendChild(growth);

        let remaining = frames;
        const step = () => {
          record();
          remaining -= 1;
          if (remaining > 0) {
            requestAnimationFrame(step);
            return;
          }
          observer.disconnect();
          resolve({
            baselineNewestBottom,
            baselineScrollTop,
            baselineScrollHeight,
            targetGrowthPx: target.getBoundingClientRect().height - baselineTargetHeight,
            finalScrollTop: scroller.scrollTop,
            finalScrollHeight: scroller.scrollHeight,
            finalBottomGap: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
            finalNewestBottom: newestTile.getBoundingClientRect().bottom,
            finalGapAfterTarget: nextTile
              ? nextTile.getBoundingClientRect().top - target.getBoundingClientRect().bottom
              : null,
            sawCommit,
            samples,
          });
        };
        requestAnimationFrame(step);
      });
    });
  }, options);

const run = async (browser: Browser, baseURL: string | undefined, world: World) => {
  const context = await browser.newContext({ ...PHONE, baseURL, locale: 'en-US' });
  try {
    await context.addInitScript(() => {
      const loops: string[] = [];
      Object.assign(window, { resizeLoops: loops });
      window.addEventListener('error', (event) => {
        if (/ResizeObserver loop/.test(event.message)) loops.push(event.message);
      });
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await page.evaluate(
      (route) => {
        window.history.pushState(null, '', route);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(world.rootId)}`
    );
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(`Harbor log entry ${REPLY_COUNT}`, { exact: false })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-thread-count]')).toHaveAttribute(
      'data-thread-count',
      String(REPLY_COUNT + 1),
      { timeout: 60_000 }
    );
    await expect(
      page.getByRole('button', { name: 'Load Older Messages', exact: true })
    ).toHaveCount(0);

    let previousTop = Number.NaN;
    await expect
      .poll(
        async () => {
          const state = await page.evaluate(() => {
            const rows = document.querySelector<HTMLElement>('[data-thread-count]');
            const scroller = rows?.parentElement?.parentElement;
            if (!scroller) return { scrollable: false, gap: Number.POSITIVE_INFINITY, top: -1 };
            return {
              scrollable: scroller.scrollHeight > scroller.clientHeight + 100,
              gap: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
              top: scroller.scrollTop,
            };
          });
          const still = state.top === previousTop;
          previousTop = state.top;
          return state.scrollable && state.gap <= 2 && still;
        },
        { timeout: 30_000 }
      )
      .toBe(true);

    const loopsBeforeGrowth = (await readLoopErrors(page, pageErrors)).length;

    // Case 1 (Path A): above-viewport overscan row grows while at bottom.
    const pathA = await mutateAndSampleGrowth(page, {
      kind: 'above-viewport',
      deltaPx: 80,
      frames: 8,
    });
    expect(pathA.sawCommit).toBe(true);
    expect(pathA.targetGrowthPx).toBeGreaterThanOrEqual(75);
    expect(pathA.finalScrollHeight - pathA.baselineScrollHeight).toBeGreaterThanOrEqual(75);
    expect(
      Math.max(0, ...pathA.samples.map((s) => s.newestBottom - pathA.baselineNewestBottom)),
      'Path A newest reply downward jump (px)'
    ).toBeLessThanOrEqual(2);
    expect(pathA.finalScrollTop - pathA.baselineScrollTop).toBeGreaterThanOrEqual(75);
    expect((await readLoopErrors(page, pageErrors)).slice(loopsBeforeGrowth)).toEqual([]);

    // Case 2 (Path B): in-view non-last row grows while opening pin still holds.
    const pathB = await mutateAndSampleGrowth(page, { kind: 'in-view', deltaPx: 60, frames: 8 });
    expect(pathB.sawCommit).toBe(true);
    expect(pathB.targetGrowthPx).toBeGreaterThanOrEqual(55);
    expect(pathB.finalScrollHeight - pathB.baselineScrollHeight).toBeGreaterThanOrEqual(55);
    expect(
      Math.max(0, ...pathB.samples.map((s) => s.newestBottom - pathB.baselineNewestBottom)),
      'Path B newest reply downward jump (px)'
    ).toBeLessThanOrEqual(2);
    expect(Math.abs(pathB.finalNewestBottom - pathB.baselineNewestBottom)).toBeLessThanOrEqual(2);
    const postCommitGaps = pathB.samples.flatMap((s) =>
      s.postCommit && s.gapAfterTarget !== null ? [s.gapAfterTarget] : []
    );
    expect(postCommitGaps.length).toBeGreaterThan(0);
    expect(Math.min(...postCommitGaps), 'gap after grown row (px)').toBeGreaterThanOrEqual(-1);
    expect(pathB.finalBottomGap).toBeLessThanOrEqual(2);
    expect((await readLoopErrors(page, pageErrors)).slice(loopsBeforeGrowth)).toEqual([]);

    // Case 3 (Path B after reader gesture): unfolds in place without yanking scrollTop.
    const tapBox = await page
      .getByText(`Harbor log entry ${REPLY_COUNT - 2}`, { exact: false })
      .first()
      .boundingBox();
    expect(tapBox).not.toBeNull();
    await page.touchscreen.tap(tapBox!.x + tapBox!.width / 2, tapBox!.y + tapBox!.height / 2);
    await waitFrames(page, 4);

    const postGesture = await mutateAndSampleGrowth(page, {
      kind: 'in-view',
      deltaPx: 60,
      frames: 8,
    });
    expect(postGesture.sawCommit).toBe(true);
    expect(postGesture.targetGrowthPx).toBeGreaterThanOrEqual(55);
    expect(postGesture.finalScrollHeight - postGesture.baselineScrollHeight).toBeGreaterThanOrEqual(
      55
    );
    const maxScrollDrift = Math.max(
      0,
      ...postGesture.samples.map((s) => Math.abs(s.scrollTop - postGesture.baselineScrollTop))
    );
    expect(maxScrollDrift, 'scrollTop drift after reader gesture (px)').toBeLessThanOrEqual(2);
    expect(postGesture.finalBottomGap).toBeGreaterThanOrEqual(55);
    expect(postGesture.finalGapAfterTarget).not.toBeNull();
    expect(postGesture.finalGapAfterTarget!).toBeGreaterThanOrEqual(-1);
    expect((await readLoopErrors(page, pageErrors)).slice(loopsBeforeGrowth)).toEqual([]);
  } finally {
    await context.close();
  }
};

test.describe('thread-open held-list growth flicker', () => {
  test.setTimeout(180_000);
  let world: World | undefined;

  test.beforeAll(async () => {
    if (!(await disposableHomeserverIsUp())) return;
    world = await seed();
  });

  test('Chromium phone: held row growth stays flicker-free', async ({ browser, baseURL }) => {
    test.skip(!world, `No homeserver at ${HOMESERVER}`);
    await run(browser, baseURL, world!);
  });

  test('WebKit phone: held row growth stays flicker-free', async ({ baseURL }) => {
    test.skip(!world, `No homeserver at ${HOMESERVER}`);
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    const browser = await launchWebKit();
    try {
      await run(browser, baseURL, world!);
    } finally {
      await browser.close();
    }
  });
});
