import { type Page, expect, test } from '@playwright/test';
import { disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import { getProbeScrollerCenter, startProbe, stopProbe } from '../helpers/threadJumpProbe';
import {
  THREAD_ROWS_SELECTOR as THREAD_ROWS,
  type ThreadJumpFixtureWorld as FixtureWorld,
  type ThreadJumpSetup as Setup,
  buildThreadJumpFixtureWorld,
  focusThreadScrollbar,
  installUnderReportedCountRoute,
  openAndRunThreadJump,
  openThreadCard,
  readThreadScrollState,
  waitForSettledAtRow0,
} from '../helpers/threadScrollJumpsFixture';
import { WEBKIT_EXECUTABLE } from '../helpers/webkit';

const OWNER_SETUPS: Setup[] = [
  { engine: 'chromium', viewport: 'desktop' },
  { engine: 'webkit', viewport: 'desktop' },
  { engine: 'webkit', viewport: 'phone' },
];

const scrollWheelBursts = async (
  page: Page,
  bursts: number,
  notches: number,
  pauseForBurst: (burst: number) => number,
  onBurst?: () => Promise<void>
) => {
  for (let burst = 0; burst < bursts; burst += 1) {
    for (let notch = 0; notch < notches; notch += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -240);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(16);
    }
    // eslint-disable-next-line no-await-in-loop
    if (onBurst) await onBurst();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(pauseForBurst(burst));
  }
};

const assertScrollProbeClean = (
  r: Awaited<ReturnType<typeof stopProbe>>,
  minScrolledPx: number,
  { checkUnexplained = true }: { checkUnexplained?: boolean } = {}
) => {
  const summary = JSON.stringify({
    scrolledPx: r.scrolledPx,
    maxReversalPx: r.maxReversalPx,
    maxUnexplainedPx: r.maxUnexplainedPx,
    maxSpreadPx: r.maxSpreadPx,
    lostPlaceFrames: r.lostPlaceFrames,
    jumps: r.jumps.slice(0, 3),
  });
  expect(r.scrolledPx, `scrolled upward: ${summary}`).toBeGreaterThan(minScrolledPx);
  expect(r.lostPlaceFrames, `lost place: ${summary}`).toBe(0);
  expect(r.maxReversalPx, `reversal jump: ${summary}`).toBeLessThanOrEqual(8);
  if (checkUnexplained) {
    expect(r.maxUnexplainedPx, `unexplained jump: ${summary}`).toBeLessThanOrEqual(12);
  }
  expect(r.maxSpreadPx, `row spread jump: ${summary}`).toBeLessThanOrEqual(4);
};

const measureZeroHeadroomGrowthDrift = (page: Page) =>
  page.evaluate(async (sel) => {
    const inner = document.querySelector<HTMLElement>(sel);
    let scroller = inner?.parentElement ?? null;
    while (scroller && !/^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!inner || !scroller) return null;
    scroller.scrollTop = 550;
    await new Promise((res) => setTimeout(res, 150));
    const viewTop = scroller.getBoundingClientRect().top;
    const tiles = Array.from(inner.querySelectorAll<HTMLElement>('[data-index]'));
    const aboveTile = tiles.find((el) => el.getBoundingClientRect().bottom <= viewTop - 4);
    const visibleTile = tiles.find((el) => el.getBoundingClientRect().top >= viewTop + 4);
    if (!aboveTile || !visibleTile) return { found: false };
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    let writes = 0;
    if (desc?.get && desc.set) {
      Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => desc.get!.call(scroller),
        set: (v: number) => {
          writes += 1;
          desc.set!.call(scroller, v);
        },
      });
    }
    const scrollTopBefore = scroller.scrollTop;
    const visibleTopBefore = visibleTile.getBoundingClientRect().top;
    aboveTile.style.minHeight = `${Math.round(aboveTile.getBoundingClientRect().height) + 140}px`;
    await new Promise((res) => setTimeout(res, 250));
    const scrollTopAfter = scroller.scrollTop;
    const visibleTopAfter = visibleTile.getBoundingClientRect().top;
    delete (scroller as { scrollTop?: number }).scrollTop;
    return {
      found: true,
      writes,
      scrollTopBefore: Math.round(scrollTopBefore),
      scrollTopAfter: Math.round(scrollTopAfter),
      visibleDriftPx: Math.round(visibleTopAfter - visibleTopBefore),
    };
  }, THREAD_ROWS);

test.use({ trace: 'off', video: 'off' });

test.describe('thread scroll owner invariants', () => {
  test.setTimeout(8 * 60_000);
  let world: FixtureWorld | undefined;

  test.beforeAll(async () => {
    test.setTimeout(4 * 60_000);
    if (await disposableHomeserverIsUp()) world = await buildThreadJumpFixtureWorld();
  });

  const requireFixture = (setup: Setup): FixtureWorld => {
    test.skip(!world, 'disposable homeserver is not running');
    test.skip(
      setup.engine === 'webkit' && !WEBKIT_EXECUTABLE,
      'PLAYWRIGHT_WEBKIT_EXECUTABLE not set'
    );
    return world!;
  };

  OWNER_SETUPS.forEach((setup) => {
    test(`${setup.engine} ${setup.viewport}: fast upward wheel scrolling does not jump`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRunThreadJump(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await openThreadCard(page, fixture);
          const center = await getProbeScrollerCenter(page);
          await startProbe(page, 'scrollUp', 150);
          await page.mouse.move(center.x, center.y);
          await scrollWheelBursts(page, 24, 16, (b) => (b % 3 === 0 ? 450 : 220));
          await page.waitForTimeout(1_000);
          assertScrollProbeClean(await stopProbe(page), 10_000);
          const state = await readThreadScrollState(page);
          expect(state?.headroomPx).toBe(0);
          expect(state?.row0Visible).toBe(true);
        },
        undefined,
        { enableOwner: true }
      );
    });

    test(`${setup.engine} ${setup.viewport}: 300ms-pause upward wheel scrolling does not overtake trim`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRunThreadJump(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await openThreadCard(page, fixture);
          const center = await getProbeScrollerCenter(page);
          await startProbe(page, 'scrollUp', 150);
          await page.mouse.move(center.x, center.y);
          await scrollWheelBursts(page, 24, 16, () => 300);
          await page.waitForTimeout(1_000);
          assertScrollProbeClean(await stopProbe(page), 10_000);
          const state = await readThreadScrollState(page);
          expect(state?.headroomPx).toBe(0);
          expect(state?.row0Visible).toBe(true);
        },
        undefined,
        { enableOwner: true }
      );
    });

    test(`${setup.engine} ${setup.viewport}: exhausted headroom holds pages until rest, tops up, and accepts zero-headroom growth drift`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRunThreadJump(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await openThreadCard(page, fixture, { mediaMs: 350, relationsMs: 650, clearCache: true });
          const initial = await readThreadScrollState(page);
          const center = await getProbeScrollerCenter(page);
          await startProbe(page, 'scrollUp', 150);
          await page.mouse.move(center.x, center.y);
          let minHeadroom = initial?.headroomPx ?? Number.POSITIVE_INFINITY;
          await scrollWheelBursts(
            page,
            10,
            14,
            () => 220,
            async () => {
              const st = await readThreadScrollState(page);
              if (st) minHeadroom = Math.min(minHeadroom, st.headroomPx);
            }
          );
          const beforeRest = await readThreadScrollState(page);
          await page.waitForTimeout(1_200);
          const afterRest = await readThreadScrollState(page);
          minHeadroom = Math.min(
            minHeadroom,
            beforeRest?.headroomPx ?? minHeadroom,
            afterRest?.headroomPx ?? minHeadroom
          );
          await scrollWheelBursts(page, 14, 16, () => 220);
          await page.waitForTimeout(1_000);
          assertScrollProbeClean(await stopProbe(page), 5_000, { checkUnexplained: false });

          expect(await focusThreadScrollbar(page)).toBe(true);
          await page.keyboard.press('Home');
          await waitForSettledAtRow0(page, 20_000);
          const driftCheck = await measureZeroHeadroomGrowthDrift(page);

          const summary = JSON.stringify({
            initialHeadroom: initial?.headroomPx,
            minHeadroom,
            beforeRest,
            afterRest,
            driftCheck,
          });
          expect(
            minHeadroom < (initial?.headroomPx ?? 0) * 0.8 ||
              ((beforeRest?.threadCount ?? 0) < 280 &&
                (afterRest?.threadCount ?? 0) > (beforeRest?.threadCount ?? 0) &&
                (afterRest?.scrollTop ?? 0) > (beforeRest?.scrollTop ?? 0)),
            `headroom consumed or pages held mid-gesture: ${summary}`
          ).toBe(true);
          expect(
            (afterRest?.headroomPx ?? 0) > (beforeRest?.headroomPx ?? 0) ||
              (afterRest?.threadCount ?? 0) > (beforeRest?.threadCount ?? 0),
            `rest top-up or held-page release: ${summary}`
          ).toBe(true);
          expect(driftCheck?.found).toBe(true);
          expect(driftCheck?.writes).toBe(0);
          expect(driftCheck?.scrollTopAfter).toBe(driftCheck?.scrollTopBefore);
          expect(driftCheck?.visibleDriftPx).toBeGreaterThan(80);
        },
        (page) => installUnderReportedCountRoute(page),
        { enableOwner: true }
      );
    });

    test(`${setup.engine} ${setup.viewport}: Home key and scrollbar thumb drag to top show non-blank reserve and trim to oldest row`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRunThreadJump(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await openThreadCard(page, fixture, { mediaMs: 250, relationsMs: 450, clearCache: true });
          await expect
            .poll(async () => (await readThreadScrollState(page))?.headroomPx ?? 0, {
              timeout: 15_000,
            })
            .toBeGreaterThan(2_000);
          expect(await focusThreadScrollbar(page)).toBe(true);
          await page.keyboard.press('Home');
          await page.waitForTimeout(80);
          const afterHome = await readThreadScrollState(page);
          expect(afterHome?.scrollTop ?? 999).toBeLessThanOrEqual(5);
          if ((afterHome?.headroomPx ?? 0) > 0) {
            expect(afterHome?.hasReserve && (afterHome?.visibleSkeletonRows ?? 0) > 0).toBe(true);
          }
          await waitForSettledAtRow0(page);

          await openThreadCard(page, fixture, { mediaMs: 250, relationsMs: 450, clearCache: true });
          await expect
            .poll(async () => (await readThreadScrollState(page))?.headroomPx ?? 0, {
              timeout: 15_000,
            })
            .toBeGreaterThan(2_000);
          const viewW = page.viewportSize()?.width ?? 1440;
          await expect
            .poll(
              async () => {
                const st = await readThreadScrollState(page);
                return (
                  !!st?.trackBox &&
                  !!st?.thumbBox &&
                  st.trackBox.width > 0 &&
                  st.trackBox.x >= 0 &&
                  st.trackBox.x + st.trackBox.width <= viewW + 1
                );
              },
              { timeout: 10_000 }
            )
            .toBe(true);
          await page.waitForTimeout(250);
          const { trackBox: track, thumbBox: thumb } = (await readThreadScrollState(page))!;
          const dragX = track!.x + track!.width / 2;
          const dragY = Math.max(
            track!.y + 4,
            Math.min(track!.y + track!.height - 4, thumb!.y + thumb!.height / 2)
          );
          await page.mouse.move(dragX, dragY);
          await page.mouse.down();
          await page.mouse.move(dragX, track!.y + 4, { steps: 12 });
          await page.waitForTimeout(100);
          const midDrag = await readThreadScrollState(page);
          expect(midDrag?.scrollbarDragging).toBe(true);
          expect(midDrag?.scrollTop ?? 999).toBeLessThanOrEqual(10);
          if ((midDrag?.headroomPx ?? 0) > 0) {
            expect(midDrag?.hasReserve && (midDrag?.visibleSkeletonRows ?? 0) > 0).toBe(true);
          }
          await page.mouse.up();
          await waitForSettledAtRow0(page);
        },
        undefined,
        { enableOwner: true }
      );
    });

    test(`${setup.engine} ${setup.viewport}: active touch defers trim until touchend and idle`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRunThreadJump(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await openThreadCard(page, fixture, { mediaMs: 250, relationsMs: 450, clearCache: true });
          await expect
            .poll(async () => (await readThreadScrollState(page))?.headroomPx ?? 0, {
              timeout: 15_000,
            })
            .toBeGreaterThan(2_000);
          expect(await focusThreadScrollbar(page, true)).toBe(true);
          await page.keyboard.press('Home');
          await expect
            .poll(async () => (await readThreadScrollState(page))?.threadCount ?? 0, {
              timeout: 25_000,
            })
            .toBeGreaterThanOrEqual(280);
          await page.waitForTimeout(750);
          expect((await readThreadScrollState(page))?.headroomPx ?? 0).toBeGreaterThan(0);
          await page.evaluate(() => window.dispatchEvent(new Event('touchend', { bubbles: true })));
          await waitForSettledAtRow0(page, 15_000);
        },
        undefined,
        { enableOwner: true }
      );
    });
  });

  test('chromium phone: CDP touch-swipe upward scrolling does not jump', async ({ baseURL }) => {
    const setup: Setup = { engine: 'chromium', viewport: 'phone' };
    const fixture = requireFixture(setup);
    await openAndRunThreadJump(
      setup,
      baseURL,
      fixture,
      async (page) => {
        await openThreadCard(page, fixture);
        const center = await getProbeScrollerCenter(page);
        const cdp = await page.context().newCDPSession(page);
        await startProbe(page, 'touchScrollUp', 150);
        for (let swipe = 0; swipe < 18; swipe += 1) {
          const startY = Math.round(center.y - 180);
          const endY = Math.round(center.y + 240);
          // eslint-disable-next-line no-await-in-loop
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: center.x, y: startY, id: 1 }],
          });
          for (let step = 1; step <= 8; step += 1) {
            const y = Math.round(startY + ((endY - startY) * step) / 8);
            // eslint-disable-next-line no-await-in-loop
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x: center.x, y, id: 1 }],
            });
            // eslint-disable-next-line no-await-in-loop
            await page.waitForTimeout(16);
          }
          // eslint-disable-next-line no-await-in-loop
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(swipe % 3 === 0 ? 450 : 250);
        }
        await page.waitForTimeout(1_000);
        assertScrollProbeClean(await stopProbe(page), 4_000);
      },
      undefined,
      { enableOwner: true }
    );
  });
});
