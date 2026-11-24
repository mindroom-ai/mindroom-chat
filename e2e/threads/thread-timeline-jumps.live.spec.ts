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
  { engine: 'chromium', viewport: 'desktop' },
  { engine: 'webkit', viewport: 'desktop' },
];
const VIEWPORTS: Record<Setup['viewport'], BrowserContextOptions> = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
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
    body: new Uint8Array(png(width, height, hue)),
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
                      return Number.parseFloat(inner?.style.marginTop || '0') < 0;
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
        setup.engine === 'webkit',
        'Follow-up: WebKit settle discard/replay under fast wheel scrolling'
      );
      const fixture = requireFixture(setup);
      await openAndRun(setup, baseURL, fixture, async (page) => {
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
        // Bursts pause 220 ms or 450 ms: the ledger settles 150 ms in, and the 150 ms stall
        // after its write reaches into the next burst of the shorter pauses.
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
