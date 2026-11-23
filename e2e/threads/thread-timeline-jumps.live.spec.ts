import { randomUUID } from 'node:crypto';
import {
  type BrowserContextOptions,
  type Page,
  type Route,
  chromium,
  expect,
  test,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { png, send, wait } from '../helpers/busyThreadRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER,
  type DisposableUser,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  seedRoomOverviewState,
} from '../helpers/matrix';
import {
  clearProbeCacheStore,
  getProbeScrollerCenter,
  installThreadJumpProbe,
  scrollProbeMidThread,
  startProbe,
  stopProbe,
  tapProbeScroller,
} from '../helpers/threadJumpProbe';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

/**
 * Verifies that a realistic 56-turn agent thread (folded steps, code, tables, and images) keeps
 * rows anchored across warm opens and slow cold-open back-pagination (pinned at bottom or reading
 * mid-thread) in Chromium and WebKit, and across fast upward wheel scrolling in Chromium (the
 * WebKit fast-scroll test is marked `test.fixme` pending a follow-up for settle discard/replay).
 */

type Setup = { engine: 'chromium' | 'webkit'; viewport: 'desktop' | 'phone' };
const OPEN_SETUPS: Setup[] = [
  { engine: 'chromium', viewport: 'desktop' },
  { engine: 'chromium', viewport: 'phone' },
  { engine: 'webkit', viewport: 'desktop' },
  { engine: 'webkit', viewport: 'phone' },
];
const SCROLL_SETUPS: Setup[] = [
  { engine: "chromium", viewport: "desktop" },
  { engine: "webkit", viewport: "desktop" },
  { engine: "webkit", viewport: "phone" },
];
const VIEWPORTS: Record<Setup['viewport'], BrowserContextOptions> = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true },
};

const PASSWORD = 'thread-timeline-jumps-password';
const THREAD_ROWS = '[data-timeline-rows][data-thread-count]';

const inThread = (rootId: string, replyTo: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: replyTo },
  },
});

const uploadPng = async (token: string, width: number, height: number, hue: number) => {
  const res = await fetch(`${DISPOSABLE_HOMESERVER}/_matrix/media/v3/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: png(width, height, hue),
  });
  return ((await res.json()) as { content_uri: string }).content_uri;
};

const longCollapsibleText = (turn: number): string =>
  [
    `User detailed log paste for turn #${turn}:`,
    ...Array.from(
      { length: 48 },
      (_, i) =>
        `line ${i + 1}: worker=${turn} trace=0x${((turn * 100 + i) * 2654435761)
          .toString(16)
          .slice(0, 8)} checking thread timeline scroll anchoring and layout heights`
    ),
  ].join('\n');

const longAgentAnswer = (turn: number) => {
  const extraCode = turn % 3 === 0 ? 55 : turn % 2 === 0 ? 28 : 10;
  const codeLines = Array.from(
    { length: extraCode },
    (_, i) =>
      `const step_${turn}_${i} = computeAnchorOffset(rows[${i}], scrollTop + inset - listTop);`
  ).join('\n');
  const tableRows = Array.from(
    { length: 5 },
    (_, i) => `<tr><td>metric_${turn}_${i}</td><td>${120 + i * 37}px</td><td>verified</td></tr>`
  ).join('');
  return {
    msgtype: 'm.text',
    body: `🔧 bash [1]\n\nTurn #${turn} summary.\n\n\`\`\`ts\n${codeLines}\n\`\`\`\n\nDone for turn #${turn}.`,
    format: 'org.matrix.custom.html',
    formatted_body: [
      '<p>🔧 <code>bash</code> [1]</p>',
      `<p>Turn #${turn} summary: investigated layout and scroll measurements with folded steps, code blocks, and images.</p>`,
      `<pre><code class="language-ts">${codeLines}</code></pre>`,
      `<table><thead><tr><th>Metric</th><th>Delta</th><th>Status</th></tr></thead><tbody>${tableRows}</tbody></table>`,
      `<p>Follow-up notes for turn #${turn}.</p>`,
    ].join('\n'),
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.tool_trace': {
      version: 2,
      events: [
        {
          type: 'tool_call_completed',
          tool_name: 'bash',
          args_preview: `rg "scrollTop" src/app/timeline/ # turn ${turn}`,
          result_preview: `Found 14 matches across 6 files for turn ${turn}\n`.repeat(8),
          truncated: false,
        },
      ],
    },
  };
};

type FixtureWorld = {
  reader: DisposableUser;
  agent: DisposableUser;
  roomId: string;
  longThreadRootId: string;
};

const buildFixtureWorld = async (): Promise<FixtureWorld> => {
  const tag = randomUUID().slice(0, 8);
  const reader = await registerDisposableUser(`jreader_${tag}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_dev_${tag}`, PASSWORD);
  const roomId = await createPrivateRoom(DISPOSABLE_HOMESERVER, reader.accessToken, {
    name: `Timeline Jumps ${tag}`,
    topic: 'Realistic agent thread timeline jump regression fixture',
    invite: [agent.userId],
  });
  await joinRoom(DISPOSABLE_HOMESERVER, agent.accessToken, roomId);

  const imgSized = await uploadPng(agent.accessToken, 800, 520, 40);
  const imgUnsized = await uploadPng(agent.accessToken, 680, 560, 160);
  const longThreadRootId = await send(reader, roomId, 'm.room.message', {
    msgtype: 'm.text',
    body: `Realistic agent thread (${tag})`,
  });
  let lastId = longThreadRootId;
  const sendInThread = async (user: DisposableUser, content: Record<string, unknown>) => {
    lastId = await send(user, roomId, 'm.room.message', {
      ...content,
      ...inThread(longThreadRootId, lastId),
    });
  };

  for (let turn = 1; turn <= 56; turn += 1) {
    const body =
      turn % 3 === 0
        ? longCollapsibleText(turn)
        : `Turn #${turn}: check scroll stability across folded turns and older history pages.`;
    await sendInThread(reader, { msgtype: 'm.text', body });
    // 3 intermediate agent messages -> folded behind TurnBreak by planThreadTurnFolds
    for (let step = 1; step <= 3; step += 1) {
      await sendInThread(agent, {
        msgtype: 'm.text',
        body: `Step ${step}/3 for turn #${turn}: inspecting scroll ledger measurements.\n`.repeat(
          4
        ),
        'io.mindroom.stream_status': 'completed',
      });
    }
    if (turn % 4 === 1) {
      const hasDims = turn % 8 === 1;
      await sendInThread(agent, {
        msgtype: 'm.image',
        body: `screenshot-turn-${turn}.png`,
        url: hasDims ? imgSized : imgUnsized,
        info: hasDims ? { mimetype: 'image/png', w: 800, h: 520 } : { mimetype: 'image/png' },
      });
    }
    await sendInThread(agent, longAgentAnswer(turn));
  }

  await sendInThread(agent, {
    msgtype: 'm.notice',
    body: 'Realistic agent thread timeline jump regression',
    'io.mindroom.thread_summary': {
      version: 1,
      summary: 'Realistic agent thread timeline jump regression',
      message_count: 295,
      generated_at: new Date().toISOString(),
      model: 'test',
    },
  });
  return { reader, agent, roomId, longThreadRootId };
};

const routeQuietly = (page: Page, pattern: string, handler: (route: Route) => Promise<void>) =>
  page.route(pattern, async (route) => {
    try {
      await handler(route);
    } catch {
      // Page closed while a delayed background request was in flight.
    }
  });

const openAndRun = async (
  setup: Setup,
  baseURL: string | undefined,
  fixture: FixtureWorld,
  body: (page: Page) => Promise<void>,
  beforeLogin?: (page: Page) => Promise<void>
) => {
  const browser =
    setup.engine === 'webkit'
      ? await launchWebKit()
      : await chromium.launch({
          executablePath: process.env.CHROMIUM_PATH || undefined,
          args: CHROMIUM_WITH_SCROLLBARS.args,
        });
  try {
    const context = await browser.newContext({ ...VIEWPORTS[setup.viewport], baseURL });
    const page = await context.newPage();
    await page.addInitScript(installThreadJumpProbe);
    if (beforeLogin) await beforeLogin(page);

    await loginWithPassword(page, {
      homeserver: DISPOSABLE_HOMESERVER,
      username: fixture.reader.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({
      page,
      roomId: fixture.roomId,
      userId: fixture.reader.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });
    try {
      await body(page);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close();
  }
};

test.use({ trace: 'off', video: 'off' });

test.describe('thread timeline jumps reproducers', () => {
  test.setTimeout(8 * 60_000);
  let world: FixtureWorld | undefined;

  test.beforeAll(async () => {
    test.setTimeout(4 * 60_000);
    if (await disposableHomeserverIsUp()) world = await buildFixtureWorld();
  });

  const requireFixture = (setup: Setup): FixtureWorld => {
    test.skip(!world, 'disposable homeserver is not running');
    test.skip(
      setup.engine === 'webkit' && !WEBKIT_EXECUTABLE,
      'PLAYWRIGHT_WEBKIT_EXECUTABLE not set'
    );
    return world!;
  };

  const delayMediaAndRelations = async (page: Page, mediaMs: number, relationsMs: number) => {
    await routeQuietly(page, '**/_matrix/client/v1/media/**', async (route) => {
      await wait(mediaMs);
      await route.continue();
    });
    await routeQuietly(page, '**/relations/**', async (route) => {
      if (route.request().url().includes('from=')) await wait(relationsMs);
      await route.continue();
    });
  };

  const gotoThreadCard = async (page: Page, fixture: FixtureWorld) => {
    await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
    const card = page.locator(
      `[data-compact-room-view="true"] [data-thread-root-id="${fixture.longThreadRootId}"]`
    );
    await expect(card).toBeVisible({ timeout: 30_000 });
    return card;
  };

  const setupColdThreadRoutes = async (
    page: Page,
    fixture: FixtureWorld,
    net: { relationsPages: number; relationsDone: boolean }
  ) => {
    const encodedRoot = encodeURIComponent(fixture.longThreadRootId);
    // Delay images into the ~150 ms unsettled window right after page 1 mounts Load Older.
    await routeQuietly(page, '**/_matrix/client/v1/media/**', async (route) => {
      await wait(960);
      await route.continue();
    });
    // Keep room /messages backfill from pre-populating the thread SDK timeline before cold open.
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
      await openAndRun(setup, baseURL, fixture, async (page) => {
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
        await openAndRun(
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
              // Tapping hands anchoring from the open-pin loop to the ledger + useFooterBottomPin.
              await page.waitForTimeout(250);
              await tapProbeScroller(page);
              // Once page 1 mounts Load Older (marginTop < 0), add a composer line inside the
              // unsettled window so useFooterBottomPin and useListEndClamp both run.
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

  const readThreadScrollState = (page: Page) =>
    page.evaluate((sel) => {
      const inner = document.querySelector<HTMLElement>(sel);
      let scroller: HTMLElement | null = inner?.parentElement ?? null;
      while (scroller) {
        const oy = getComputedStyle(scroller).overflowY;
        if (oy === "auto" || oy === "scroll") break;
        scroller = scroller.parentElement;
      }
      if (!inner || !scroller) return null;
      const view = scroller.getBoundingClientRect();
      const reserve = inner.querySelector<HTMLElement>('[data-testid="thread-headroom-reserve"]');
      const skeletonRows = Array.from(
        inner.querySelectorAll<HTMLElement>('[data-headroom-skeleton-row="true"]')
      );
      const visibleSkeletonRows = skeletonRows.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.bottom > view.top && r.top < view.bottom;
      }).length;
      const row0 = inner.querySelector<HTMLElement>('[data-index="0"]');
      const row0Rect = row0?.getBoundingClientRect();
      const row0Visible =
        !!row0Rect && row0Rect.height > 0 && row0Rect.bottom > view.top && row0Rect.top < view.bottom;
      const track = scroller.querySelector<HTMLElement>('[role="scrollbar"]');
      const thumb = track?.querySelector<HTMLElement>('[data-scrollbar-thumb="true"]');
      const trackRect = track?.getBoundingClientRect();
      const thumbRect = thumb?.getBoundingClientRect();
      return {
        scrollTop: Math.round(scroller.scrollTop),
        scrollHeight: Math.round(scroller.scrollHeight),
        clientHeight: Math.round(scroller.clientHeight),
        headroomPx: Number(inner.dataset.headroomPx ?? 0),
        threadCount: Number(inner.dataset.threadCount ?? 0),
        hasReserve: !!reserve,
        visibleSkeletonRows,
        row0Visible,
        scrollbarDragging: scroller.dataset.scrollbarDragging === "true",
        trackBox: trackRect
          ? { x: trackRect.x, y: trackRect.y, width: trackRect.width, height: trackRect.height }
          : null,
        thumbBox: thumbRect
          ? { x: thumbRect.x, y: thumbRect.y, width: thumbRect.width, height: thumbRect.height }
          : null,
        stats: (window as unknown as { __threadScrollOwnerStats?: Record<string, unknown> })
          .__threadScrollOwnerStats ?? null,
      };
    }, THREAD_ROWS);

  const openThreadWithOwner = async (
    page: Page,
    fixture: FixtureWorld,
    opts: { mediaMs?: number; relationsMs?: number; clearCache?: boolean } = {}
  ) => {
    await delayMediaAndRelations(page, opts.mediaMs ?? 350, opts.relationsMs ?? 650);
    const card = await gotoThreadCard(page, fixture);
    if (opts.clearCache) await clearProbeCacheStore(page);
    await page.waitForTimeout(400);
    await card.click();
    await expect(page.locator(THREAD_ROWS)).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => page.locator('[data-message-item]').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(250);
  };

  SCROLL_SETUPS.forEach((setup) => {
    test(`${setup.engine} ${setup.viewport}: fast upward wheel scrolling through realistic history does not jump`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRun(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await openThreadWithOwner(page, fixture);
          const center = await getProbeScrollerCenter(page);
          await startProbe(page, 'scrollUp', 150);
          await page.mouse.move(center.x, center.y);
          for (let burst = 0; burst < 24; burst += 1) {
            for (let notch = 0; notch < 16; notch += 1) {
              await page.mouse.wheel(0, -240);
              await page.waitForTimeout(16);
            }
            await page.waitForTimeout(burst % 3 === 0 ? 450 : 220);
          }
          await page.waitForTimeout(1_000);
          const r = await stopProbe(page);
          const state = await readThreadScrollState(page);
          const summary = JSON.stringify({
            scrolledPx: r.scrolledPx,
            threadCountStart: r.threadCountStart,
            threadCountEnd: r.threadCountEnd,
            maxReversalPx: r.maxReversalPx,
            maxUnexplainedPx: r.maxUnexplainedPx,
            maxSpreadPx: r.maxSpreadPx,
            lostPlaceFrames: r.lostPlaceFrames,
            stats: state?.stats,
            topJumps: r.jumps.slice(0, 5),
          });
          console.log(`OWNER-FAST-SCROLL ${setup.engine} ${setup.viewport}: ${summary}`);
          const msg = (label: string) => `${label}: ${summary}`;
          expect(r.scrolledPx, "scrolled upward").toBeGreaterThan(10_000);
          expect(r.lostPlaceFrames, msg("lost place")).toBe(0);
          expect(r.maxReversalPx, msg("reversal jump")).toBeLessThanOrEqual(8);
          expect(r.maxUnexplainedPx, msg("unexplained jump")).toBeLessThanOrEqual(12);
          expect(r.maxSpreadPx, msg("row spread jump")).toBeLessThanOrEqual(4);
        },
        async (page) => {
          await page.addInitScript(() => window.localStorage.setItem("mr.threadScrollOwner", "1"));
        }
      );
    });

    test(`${setup.engine} ${setup.viewport}: 300ms-pause upward wheel scrolling does not overtake trim`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRun(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await openThreadWithOwner(page, fixture);
          const center = await getProbeScrollerCenter(page);
          await startProbe(page, 'scrollUp', 150);
          await page.mouse.move(center.x, center.y);
          for (let burst = 0; burst < 24; burst += 1) {
            for (let notch = 0; notch < 16; notch += 1) {
              await page.mouse.wheel(0, -240);
              await page.waitForTimeout(16);
            }
            // Every pause is 300 ms — previously 40 ms past a 260 ms trim timer.
            await page.waitForTimeout(300);
          }
          await page.waitForTimeout(1_000);
          const r = await stopProbe(page);
          const state = await readThreadScrollState(page);
          const summary = JSON.stringify({
            scrolledPx: r.scrolledPx,
            threadCountStart: r.threadCountStart,
            threadCountEnd: r.threadCountEnd,
            maxReversalPx: r.maxReversalPx,
            maxUnexplainedPx: r.maxUnexplainedPx,
            maxSpreadPx: r.maxSpreadPx,
            lostPlaceFrames: r.lostPlaceFrames,
            headroomPx: state?.headroomPx,
            stats: state?.stats,
            topJumps: r.jumps.slice(0, 5),
          });
          console.log(`OWNER-300MS-PAUSE ${setup.engine} ${setup.viewport}: ${summary}`);
          const msg = (label: string) => `${label}: ${summary}`;
          expect(r.scrolledPx, "scrolled upward").toBeGreaterThan(10_000);
          expect(r.lostPlaceFrames, msg("lost place")).toBe(0);
          expect(r.maxReversalPx, msg("reversal jump")).toBeLessThanOrEqual(8);
          expect(r.maxUnexplainedPx, msg("unexplained jump")).toBeLessThanOrEqual(12);
          expect(r.maxSpreadPx, msg("row spread jump")).toBeLessThanOrEqual(4);
        },
        async (page) => {
          await page.addInitScript(() => window.localStorage.setItem("mr.threadScrollOwner", "1"));
        }
      );
    });

    test(`${setup.engine} ${setup.viewport}: exhausted headroom holds fetched pages until rest, tops up, and accepts drift on zero-headroom growth`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRun(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await openThreadWithOwner(page, fixture, { mediaMs: 250, relationsMs: 250, clearCache: true });
          const center = await getProbeScrollerCenter(page);
          await startProbe(page, 'scrollUp', 150);
          await page.mouse.move(center.x, center.y);
          // First 10 rapid bursts exhaust the capped 1,200 px initial headroom mid-gesture so
          // incoming pages must be held out of threadEvents rather than writing scrollTop.
          for (let burst = 0; burst < 10; burst += 1) {
            for (let notch = 0; notch < 14; notch += 1) {
              await page.mouse.wheel(0, -240);
              await page.waitForTimeout(16);
            }
            await page.waitForTimeout(220);
          }
          // Rest > 500 ms so held pages release and headroom tops up cleanly at rest.
          await page.waitForTimeout(900);
          // Continue scrolling upward through the newly topped-up headroom.
          for (let burst = 0; burst < 16; burst += 1) {
            for (let notch = 0; notch < 16; notch += 1) {
              await page.mouse.wheel(0, -240);
              await page.waitForTimeout(16);
            }
            await page.waitForTimeout(220);
          }
          await page.waitForTimeout(1_000);
          const r = await stopProbe(page);
          const afterScroll = await readThreadScrollState(page);

          // Now verify late row growth above the reader with zero headroom accepts anchor drift
          // instead of issuing a scrollTop write: finish reaching top so headroom trims to 0, then
          // scroll slightly down so row 0 is mounted in overscan above the viewport and grow it.
          await page.evaluate((sel) => {
            const inner = document.querySelector<HTMLElement>(sel);
            let scroller: HTMLElement | null = inner?.parentElement ?? null;
            while (scroller) {
              const oy = getComputedStyle(scroller).overflowY;
              if (oy === "auto" || oy === "scroll") break;
              scroller = scroller.parentElement;
            }
            if (scroller) scroller.scrollTop = 0;
          }, THREAD_ROWS);
          await expect
            .poll(async () => (await readThreadScrollState(page))?.headroomPx ?? -1, {
              timeout: 20_000,
            })
            .toBe(0);

          const driftCheck = await page.evaluate(async (sel) => {
            const inner = document.querySelector<HTMLElement>(sel);
            let scroller: HTMLElement | null = inner?.parentElement ?? null;
            while (scroller) {
              const oy = getComputedStyle(scroller).overflowY;
              if (oy === "auto" || oy === "scroll") break;
              scroller = scroller.parentElement;
            }
            if (!inner || !scroller) return null;
            // Scroll ~550 px down so row 0 is completely above viewport yet still mounted in overscan.
            scroller.scrollTop = 550;
            await new Promise((r) => setTimeout(r, 150));
            const viewTop = scroller.getBoundingClientRect().top;
            const aboveTile = Array.from(inner.querySelectorAll<HTMLElement>('[data-index]')).find(
              (el) => el.getBoundingClientRect().bottom <= viewTop - 4
            );
            if (!aboveTile) return { foundAbove: false };
            const stats = (window as unknown as {
              __threadScrollOwnerStats?: { writes: number; zeroHeadroomGrowthDrifts: number };
            }).__threadScrollOwnerStats;
            const writesBefore = stats?.writes ?? 0;
            const driftsBefore = stats?.zeroHeadroomGrowthDrifts ?? 0;
            const scrollTopBefore = scroller.scrollTop;
            aboveTile.style.minHeight = `${Math.round(aboveTile.getBoundingClientRect().height) + 140}px`;
            await new Promise((r) => setTimeout(r, 250));
            return {
              foundAbove: true,
              writesBefore,
              writesAfter: stats?.writes ?? 0,
              driftsBefore,
              driftsAfter: stats?.zeroHeadroomGrowthDrifts ?? 0,
              scrollTopBefore: Math.round(scrollTopBefore),
              scrollTopAfter: Math.round(scroller.scrollTop),
            };
          }, THREAD_ROWS);

          const summary = JSON.stringify({
            scrolledPx: r.scrolledPx,
            maxReversalPx: r.maxReversalPx,
            maxUnexplainedPx: r.maxUnexplainedPx,
            maxSpreadPx: r.maxSpreadPx,
            lostPlaceFrames: r.lostPlaceFrames,
            stats: afterScroll?.stats,
            driftCheck,
            topJumps: r.jumps.slice(0, 5),
          });
          console.log(`OWNER-EXHAUSTED ${setup.engine} ${setup.viewport}: ${summary}`);
          const msg = (label: string) => `${label}: ${summary}`;
          expect(r.scrolledPx, "scrolled upward").toBeGreaterThan(5_000);
          expect(r.lostPlaceFrames, msg("lost place")).toBe(0);
          expect(r.maxReversalPx, msg("reversal jump")).toBeLessThanOrEqual(8);
          expect(r.maxUnexplainedPx, msg("unexplained jump")).toBeLessThanOrEqual(12);
          expect(r.maxSpreadPx, msg("row spread jump")).toBeLessThanOrEqual(4);
          const ownerStats = afterScroll?.stats as
            | { heldPages?: number; releasedHeldPages?: number; topUps?: number }
            | undefined;
          expect(
            (ownerStats?.heldPages ?? 0) + (ownerStats?.topUps ?? 0),
            msg("exhaustion triggered held pages or rest top-up")
          ).toBeGreaterThan(0);
          if ((ownerStats?.heldPages ?? 0) > 0) {
            expect(ownerStats?.releasedHeldPages ?? 0, msg("held pages released at rest")).toBeGreaterThan(0);
          }
          expect(driftCheck?.foundAbove, msg("found mounted row above viewport")).toBe(true);
          expect(driftCheck?.writesAfter, msg("zero scrollTop writes on zero-headroom growth")).toBe(
            driftCheck?.writesBefore
          );
          expect(driftCheck?.scrollTopAfter, msg("scrollTop unchanged on zero-headroom growth")).toBe(
            driftCheck?.scrollTopBefore
          );
          expect(
            (driftCheck?.driftsAfter ?? 0) - (driftCheck?.driftsBefore ?? 0),
            msg("recorded zero-headroom growth drift")
          ).toBeGreaterThan(0);
        },
        async (page) => {
          await page.addInitScript(() => {
            window.localStorage.setItem("mr.threadScrollOwner", "1");
            window.localStorage.setItem("mr.threadScrollOwner.testInitialHeadroomPx", "1200");
          });
        }
      );
    });

    test(`${setup.engine} ${setup.viewport}: Home key and scrollbar thumb drag to top show non-blank reserve and trim to oldest row`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRun(
        setup,
        baseURL,
        fixture,
        async (page) => {
          // Part 1: Home key into active headroom reserve
          await openThreadWithOwner(page, fixture, { mediaMs: 250, relationsMs: 450, clearCache: true });
          await expect
            .poll(async () => (await readThreadScrollState(page))?.headroomPx ?? 0, {
              timeout: 15_000,
            })
            .toBeGreaterThan(2_000);

          // Focus the thread scrollbar and press Home to jump to scrollTop 0 inside the reserve.
          const focused = await page.evaluate((sel) => {
            const inner = document.querySelector<HTMLElement>(sel);
            let scroller: HTMLElement | null = inner?.parentElement ?? null;
            while (scroller) {
              const oy = getComputedStyle(scroller).overflowY;
              if (oy === "auto" || oy === "scroll") break;
              scroller = scroller.parentElement;
            }
            const track = scroller?.querySelector<HTMLElement>('[role="scrollbar"]');
            if (!track) return false;
            track.focus();
            return document.activeElement === track;
          }, THREAD_ROWS);
          expect(focused, "focused thread scrollbar").toBe(true);
          await page.keyboard.press("Home");
          await page.waitForTimeout(80);

          const afterHomeInReserve = await readThreadScrollState(page);
          expect(afterHomeInReserve?.scrollTop ?? 999, "Home reached top").toBeLessThanOrEqual(5);
          if ((afterHomeInReserve?.headroomPx ?? 0) > 0) {
            expect(
              afterHomeInReserve?.hasReserve && (afterHomeInReserve?.visibleSkeletonRows ?? 0) > 0,
              `reserve visible after Home (not blank): ${JSON.stringify(afterHomeInReserve)}`
            ).toBe(true);
          }

          // Once history completes and reader rests, trim must target the oldest row (row 0).
          await expect
            .poll(
              async () => {
                const st = await readThreadScrollState(page);
                return st ? st.headroomPx === 0 && st.scrollTop <= 2 && st.row0Visible : false;
              },
              { timeout: 30_000 }
            )
            .toBe(true);
          const afterHomeSettled = await readThreadScrollState(page);

          // Part 2: Re-open fresh with reserve and drag the scrollbar thumb all the way to the top.
          await openThreadWithOwner(page, fixture, { mediaMs: 250, relationsMs: 450, clearCache: true });
          await expect
            .poll(async () => (await readThreadScrollState(page))?.headroomPx ?? 0, {
              timeout: 15_000,
            })
            .toBeGreaterThan(2_000);

          const beforeDrag = await readThreadScrollState(page);
          expect(beforeDrag?.trackBox, "scrollbar track exists").not.toBeNull();
          expect(beforeDrag?.thumbBox, "scrollbar thumb exists").not.toBeNull();
          const track = beforeDrag!.trackBox!;
          const thumb = beforeDrag!.thumbBox!;

          await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
          await page.mouse.down();
          await page.mouse.move(track.x + track.width / 2, track.y + 4, { steps: 12 });
          await page.waitForTimeout(100);

          const midDrag = await readThreadScrollState(page);
          expect(midDrag?.scrollbarDragging, "drag flag set while holding thumb").toBe(true);
          expect(midDrag?.scrollTop ?? 999, "thumb drag reached top").toBeLessThanOrEqual(10);
          if ((midDrag?.headroomPx ?? 0) > 0) {
            expect(
              midDrag?.hasReserve && (midDrag?.visibleSkeletonRows ?? 0) > 0,
              `reserve visible during thumb drag (not blank): ${JSON.stringify(midDrag)}`
            ).toBe(true);
          }

          // Release the thumb; once history completes and input rests, trim targets row 0.
          await page.mouse.up();
          await expect
            .poll(
              async () => {
                const st = await readThreadScrollState(page);
                return st ? st.headroomPx === 0 && st.scrollTop <= 2 && st.row0Visible : false;
              },
              { timeout: 30_000 }
            )
            .toBe(true);
          const afterThumbSettled = await readThreadScrollState(page);
          console.log(
            `OWNER-HOME-THUMB ${setup.engine} ${setup.viewport}: home=${JSON.stringify({
              inReserveSkel: afterHomeInReserve?.visibleSkeletonRows,
              settledHeadroom: afterHomeSettled?.headroomPx,
              settledTop: afterHomeSettled?.scrollTop,
              row0Visible: afterHomeSettled?.row0Visible,
              threadCount: afterHomeSettled?.threadCount,
            })} thumb=${JSON.stringify({
              midDragSkel: midDrag?.visibleSkeletonRows,
              settledHeadroom: afterThumbSettled?.headroomPx,
              settledTop: afterThumbSettled?.scrollTop,
              row0Visible: afterThumbSettled?.row0Visible,
              threadCount: afterThumbSettled?.threadCount,
            })}`
          );
        },
        async (page) => {
          await page.addInitScript(() => window.localStorage.setItem("mr.threadScrollOwner", "1"));
        }
      );
    });

    test(`${setup.engine} ${setup.viewport}: active touch defers trim until touchend and idle`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRun(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await openThreadWithOwner(page, fixture, { mediaMs: 150, relationsMs: 150, clearCache: true });
          await expect
            .poll(async () => (await readThreadScrollState(page))?.headroomPx ?? 0, {
              timeout: 15_000,
            })
            .toBeGreaterThan(2_000);

          // Hold a finger down on window BEFORE jumping to top so activeTouches > 0 blocks trim.
          await page.evaluate((sel) => {
            window.dispatchEvent(new Event("touchstart", { bubbles: true }));
            const inner = document.querySelector<HTMLElement>(sel);
            let scroller: HTMLElement | null = inner?.parentElement ?? null;
            while (scroller) {
              const oy = getComputedStyle(scroller).overflowY;
              if (oy === "auto" || oy === "scroll") break;
              scroller = scroller.parentElement;
            }
            const track = scroller?.querySelector<HTMLElement>('[role="scrollbar"]');
            track?.focus();
          }, THREAD_ROWS);
          await page.keyboard.press("Home");

          // Wait until all history loads AND wait 750 ms (> 500 ms idle) while finger is STILL down.
          await expect
            .poll(async () => (await readThreadScrollState(page))?.threadCount ?? 0, {
              timeout: 25_000,
            })
            .toBeGreaterThanOrEqual(280);
          await page.waitForTimeout(750);

          const whileFingerDown = await readThreadScrollState(page);
          expect(
            whileFingerDown?.headroomPx ?? 0,
            `trim must stay deferred while activeTouches > 0: ${JSON.stringify(whileFingerDown)}`
          ).toBeGreaterThan(0);

          // Lift finger: trim must now fire cleanly after idle and reach row 0.
          await page.evaluate(() => {
            window.dispatchEvent(new Event("touchend", { bubbles: true }));
          });
          await expect
            .poll(
              async () => {
                const st = await readThreadScrollState(page);
                return st ? st.headroomPx === 0 && st.scrollTop <= 2 && st.row0Visible : false;
              },
              { timeout: 15_000 }
            )
            .toBe(true);
          const afterLift = await readThreadScrollState(page);
          console.log(
            `OWNER-TOUCH-GATE ${setup.engine} ${setup.viewport}: heldHeadroom=${whileFingerDown?.headroomPx} afterLiftHeadroom=${afterLift?.headroomPx} row0=${afterLift?.row0Visible}`
          );
        },
        async (page) => {
          await page.addInitScript(() => window.localStorage.setItem("mr.threadScrollOwner", "1"));
        }
      );
    });
  });

  // Real touch-swipe dispatch: Chromium supports CDP Input.dispatchTouchEvent; Playwright WebKit
  // only supports touchscreen.tap() (no touch move / flick), so a real iPhone flick requires a
  // hand test on physical hardware before flipping the flag.
  test("chromium phone: CDP touch-swipe upward scrolling through realistic history does not jump", async ({
    baseURL,
  }) => {
    const setup: Setup = { engine: "chromium", viewport: "phone" };
    const fixture = requireFixture(setup);
    await openAndRun(
      setup,
      baseURL,
      fixture,
      async (page) => {
        await openThreadWithOwner(page, fixture);
        const center = await getProbeScrollerCenter(page);
        const cdp = await page.context().newCDPSession(page);
        await startProbe(page, 'scrollUp', 150);
        for (let swipe = 0; swipe < 18; swipe += 1) {
          const startY = Math.round(center.y - 180);
          const endY = Math.round(center.y + 240);
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: center.x, y: startY, id: 1 }],
          });
          for (let step = 1; step <= 8; step += 1) {
            const y = Math.round(startY + ((endY - startY) * step) / 8);
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: center.x, y, id: 1 }],
            });
            await page.waitForTimeout(16);
          }
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await page.waitForTimeout(swipe % 3 === 0 ? 450 : 250);
        }
        await page.waitForTimeout(1_000);
        const r = await stopProbe(page);
        const state = await readThreadScrollState(page);
        const summary = JSON.stringify({
          scrolledPx: r.scrolledPx,
          threadCountStart: r.threadCountStart,
          threadCountEnd: r.threadCountEnd,
          maxReversalPx: r.maxReversalPx,
          maxUnexplainedPx: r.maxUnexplainedPx,
          maxSpreadPx: r.maxSpreadPx,
          lostPlaceFrames: r.lostPlaceFrames,
          stats: state?.stats,
        });
        console.log(`OWNER-CDP-TOUCH chromium phone: ${summary}`);
        const msg = (label: string) => `${label}: ${summary}`;
        expect(r.scrolledPx, "touch scrolled upward").toBeGreaterThan(4_000);
        expect(r.lostPlaceFrames, msg("lost place")).toBe(0);
        expect(r.maxReversalPx, msg("reversal jump")).toBeLessThanOrEqual(8);
        expect(r.maxUnexplainedPx, msg("unexplained jump")).toBeLessThanOrEqual(12);
        expect(r.maxSpreadPx, msg("row spread jump")).toBeLessThanOrEqual(4);
      },
      async (page) => {
        await page.addInitScript(() => window.localStorage.setItem("mr.threadScrollOwner", "1"));
      }
    );
  });
});
