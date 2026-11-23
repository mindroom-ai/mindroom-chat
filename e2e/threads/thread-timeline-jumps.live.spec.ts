import { type Page, expect, test } from '@playwright/test';
import { wait } from '../helpers/busyThreadRoom';
import { disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import {
  clearProbeCacheStore,
  getProbeScrollerCenter,
  scrollProbeMidThread,
  startProbe,
  stopProbe,
  tapProbeScroller,
} from '../helpers/threadJumpProbe';
import {
  THREAD_ROWS_SELECTOR as THREAD_ROWS,
  type ThreadJumpFixtureWorld as FixtureWorld,
  type ThreadJumpSetup as Setup,
  buildThreadJumpFixtureWorld,
  delayMediaAndRelations,
  gotoThreadCard,
  openAndRunThreadJump,
  routeQuietly,
} from '../helpers/threadScrollJumpsFixture';
import { WEBKIT_EXECUTABLE } from '../helpers/webkit';

/**
 * Verifies that a realistic 56-turn agent thread (folded steps, code, tables, and images) keeps
 * rows anchored across warm opens, slow cold-open back-pagination (pinned at bottom or reading
 * mid-thread), and fast upward wheel scrolling on both the legacy and thread-scroll-owner paths.
 */

const OPEN_SETUPS: Setup[] = [
  { engine: 'chromium', viewport: 'desktop' },
  { engine: 'chromium', viewport: 'phone' },
  { engine: 'webkit', viewport: 'desktop' },
  { engine: 'webkit', viewport: 'phone' },
];
const SCROLL_SETUPS: Setup[] = [
  { engine: 'chromium', viewport: 'desktop' },
  { engine: 'webkit', viewport: 'desktop' },
];

test.use({ trace: 'off', video: 'off' });

test.describe('thread timeline jumps reproducers', () => {
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

  const setupColdThreadRoutes = async (
    page: Page,
    fixture: FixtureWorld,
    net: { relationsPages: number; relationsDone: boolean }
  ) => {
    const encodedRoot = encodeURIComponent(fixture.longThreadRootId);
    await routeQuietly(page, '**/_matrix/client/v1/media/**', async (route) => {
      await wait(960);
      await route.continue();
    });
    await routeQuietly(page, '**/_matrix/client/*/rooms/*/messages**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ chunk: [], start: '', end: '' }),
      })
    );
    await routeQuietly(page, '**/relations/**', async (route) => {
      const url = new URL(route.request().url());
      const isThreadTimeline =
        url.pathname.endsWith(`/relations/${encodedRoot}`) ||
        url.pathname.endsWith(`/relations/${fixture.longThreadRootId}`);
      if (!isThreadTimeline) {
        await route.continue();
        return;
      }
      url.searchParams.set('limit', '20');
      await wait(url.searchParams.has('from') ? 450 : 900);
      const response = await route.fetch({ url: url.toString() });
      const body = await response.text();
      net.relationsPages += 1;
      try {
        if (!(JSON.parse(body) as { next_batch?: string }).next_batch) net.relationsDone = true;
      } catch {
        // Ignore non-JSON error responses.
      }
      await route.fulfill({ response, body });
    });
  };

  OPEN_SETUPS.forEach((setup) => {
    test(`${setup.engine} ${setup.viewport}: opening a realistic folded-turn thread does not jump or flash blank`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRunThreadJump(setup, baseURL, fixture, async (page) => {
        await delayMediaAndRelations(page, 350, 350);
        const card = await gotoThreadCard(page, fixture);
        await page.waitForTimeout(600);

        await startProbe(page, 'open');
        await card.click();
        await expect(page.locator(THREAD_ROWS)).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(2_000);
        const r = await stopProbe(page);
        const summary = JSON.stringify({
          maxRowJumpPx: r.maxRowJumpPx,
          maxBottomGapJumpPx: r.maxBottomGapJumpPx,
          minVisibleCount: r.minVisibleCount,
          topJumps: r.jumps.slice(0, 4),
        });
        const msg = (label: string) => `${label}: ${summary}`;
        expect(r.visibleFrames, 'visible open frames').toBeGreaterThan(20);
        expect(r.minVisibleCount, msg('blank screen on open')).toBeGreaterThan(0);
        expect(r.maxRowJumpPx, msg('row jump after reveal')).toBeLessThanOrEqual(4);
        expect(r.maxBottomGapJumpPx, msg('bottom-gap jump')).toBeLessThanOrEqual(20);
      });
    });

    (['bottom', 'mid-thread'] as const).forEach((start) => {
      test(`${setup.engine} ${setup.viewport}: cold open (${start}) across 10+ slow /relations pages does not jump`, async ({
        baseURL,
      }) => {
        const fixture = requireFixture(setup);
        const net = { relationsPages: 0, relationsDone: false };
        await openAndRunThreadJump(
          setup,
          baseURL,
          fixture,
          async (page) => {
            const card = await gotoThreadCard(page, fixture);
            await clearProbeCacheStore(page);

            let scrolledUp = { ok: true, before: 0, after: 0 };
            if (start === 'bottom') {
              await startProbe(page, 'open');
              await card.click();
              await expect(page.locator(THREAD_ROWS)).toBeVisible({ timeout: 30_000 });
              await page.waitForTimeout(250);
              await tapProbeScroller(page);
              await expect
                .poll(
                  () =>
                    page.evaluate((sel) => {
                      const inner = document.querySelector<HTMLElement>(sel);
                      return (
                        Number.parseFloat(inner?.style.marginTop || '0') < 0 ||
                        Number(inner?.dataset.headroomPx || '0') > 0
                      );
                    }, THREAD_ROWS),
                  { timeout: 30_000, intervals: [15] }
                )
                .toBe(true);
              const composer = page.locator('[contenteditable="true"]').last();
              if (await composer.isVisible().catch(() => false)) {
                await composer.click();
                await page.keyboard.type('a');
                await page.keyboard.press('Shift+Enter');
                await page.keyboard.type('b');
              }
            } else {
              await card.click();
              await expect(page.locator(THREAD_ROWS)).toBeVisible({ timeout: 30_000 });
              await expect
                .poll(() => net.relationsPages, { timeout: 30_000 })
                .toBeGreaterThanOrEqual(2);
              await page.waitForTimeout(120);
              scrolledUp = await scrollProbeMidThread(page);
              await page.waitForTimeout(200);
              await startProbe(page, 'open');
            }

            await expect
              .poll(() => net.relationsDone && net.relationsPages >= 10, { timeout: 60_000 })
              .toBe(true);
            await page.waitForTimeout(800);
            const r = await stopProbe(page);
            const summary = JSON.stringify({
              start,
              relationsPages: net.relationsPages,
              ...(start === 'mid-thread' ? { scrolledUp } : {}),
              threadCountStart: r.threadCountStart,
              threadCountEnd: r.threadCountEnd,
              minVisibleCount: r.minVisibleCount,
              maxRowJumpPx: r.maxRowJumpPx,
              maxBottomOffsetPx: r.maxBottomOffsetPx,
              maxBottomGapJumpPx: r.maxBottomGapJumpPx,
              maxAnchorDriftPx: r.maxAnchorDriftPx,
              topJumps: r.jumps.slice(0, 10),
            });
            const msg = (label: string) => `${label}: ${summary}`;
            expect(net.relationsPages, msg('10+ /relations pages')).toBeGreaterThanOrEqual(10);
            expect(r.threadCountEnd, msg('full thread loaded')).toBeGreaterThanOrEqual(280);
            expect(r.visibleFrames, `visible cold-open (${start}) frames`).toBeGreaterThan(20);
            expect(r.minVisibleCount, msg(`blank cold open (${start})`)).toBeGreaterThan(0);
            if (start === 'bottom') {
              expect(r.threadCountStart, msg('cold open start')).toBeLessThanOrEqual(40);
              expect(r.maxBottomOffsetPx, msg('bottom displacement')).toBeLessThanOrEqual(4);
            } else {
              expect(scrolledUp.ok, msg('scroll mid-thread')).toBe(true);
              expect(r.maxRowJumpPx, msg('mid-thread row jump')).toBeLessThanOrEqual(4);
              expect(r.maxAnchorDriftPx, msg('mid-thread anchor drift')).toBeLessThanOrEqual(20);
            }
          },
          (page) => setupColdThreadRoutes(page, fixture, net)
        );
      });
    });
  });

  SCROLL_SETUPS.forEach((setup) => {
    test(`${setup.engine} ${setup.viewport}: fast upward wheel scrolling through realistic history does not jump`, async ({
      baseURL,
    }) => {
      test.fixme(
        setup.engine === 'webkit' && process.env.MR_THREAD_SCROLL_OWNER !== '1',
        'Legacy ledger WebKit settle discard/replay under fast wheel scrolling (fixed by mindroom.threadScrollOwner=1)'
      );
      const fixture = requireFixture(setup);
      await openAndRunThreadJump(setup, baseURL, fixture, async (page) => {
        await delayMediaAndRelations(page, 350, 650);
        const card = await gotoThreadCard(page, fixture);
        await page.waitForTimeout(600);

        await card.click();
        await expect(page.locator(THREAD_ROWS)).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(async () => page.locator('[data-message-item]').count(), { timeout: 15_000 })
          .toBeGreaterThan(0);
        await page.waitForTimeout(250);

        const center = await getProbeScrollerCenter(page);
        await startProbe(page, 'scrollUp', 150);
        await page.mouse.move(center.x, center.y);
        for (let burst = 0; burst < 24; burst += 1) {
          for (let notch = 0; notch < 16; notch += 1) {
            // eslint-disable-next-line no-await-in-loop
            await page.mouse.wheel(0, -240);
            // eslint-disable-next-line no-await-in-loop
            await page.waitForTimeout(16);
          }
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(burst % 3 === 0 ? 450 : 220);
        }
        await page.waitForTimeout(1_000);
        const r = await stopProbe(page);
        const summary = JSON.stringify({
          scrolledPx: r.scrolledPx,
          threadCountStart: r.threadCountStart,
          threadCountEnd: r.threadCountEnd,
          maxReversalPx: r.maxReversalPx,
          maxUnexplainedPx: r.maxUnexplainedPx,
          maxSpreadPx: r.maxSpreadPx,
          lostPlaceFrames: r.lostPlaceFrames,
          topJumps: r.jumps.slice(0, 5),
        });
        const msg = (label: string) => `${label}: ${summary}`;
        expect(r.scrolledPx, 'scrolled upward').toBeGreaterThan(10_000);
        expect(r.lostPlaceFrames, msg('lost place')).toBe(0);
        expect(r.maxReversalPx, msg('reversal jump')).toBeLessThanOrEqual(8);
        expect(r.maxUnexplainedPx, msg('unexplained jump')).toBeLessThanOrEqual(12);
        expect(r.maxSpreadPx, msg('row spread jump')).toBeLessThanOrEqual(4);
      });
    });
  });
});
