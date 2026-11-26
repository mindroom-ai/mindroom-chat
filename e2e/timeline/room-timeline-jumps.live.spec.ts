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
  getProbeScrollerCenter,
  installThreadJumpProbe,
  startProbe,
  stopProbe,
} from '../helpers/threadJumpProbe';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

/**
 * Room-timeline mirror of the fast upward wheel scroll test in
 * `e2e/threads/thread-timeline-jumps.live.spec.ts` (same 56-turn realistic history, media/backfill
 * delays, wheel burst cadence, and `threadJumpProbe` metrics) to measure main's room ledger.
 */

type Setup = { engine: 'chromium' | 'webkit'; viewport: 'desktop' };
const SCROLL_SETUPS: Setup[] = [
  { engine: 'chromium', viewport: 'desktop' },
  { engine: 'webkit', viewport: 'desktop' },
];
const VIEWPORTS: Record<Setup['viewport'], BrowserContextOptions> = {
  desktop: { viewport: { width: 1440, height: 900 } },
};

const PASSWORD = 'room-timeline-jumps-password';
const ROOM_ROWS = '[data-timeline-rows][data-testid="room-virtual-inner"]';

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
          .slice(0, 8)} checking room timeline scroll anchoring and layout heights`
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
      `<p>Turn #${turn} summary: investigated layout and scroll measurements with collapsible logs, code blocks, and images.</p>`,
      `<pre><code class="language-ts">${codeLines}</code></pre>`,
      `<table><thead><tr><th>Metric</th><th>Delta</th><th>Status</th></tr></thead><tbody>${tableRows}</tbody></table>`,
      `<p>Follow-up notes for turn #${turn}.</p>`,
    ].join('\n'),
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.ai_run': { version: 1, status: 'completed' },
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
};

const buildFixtureWorld = async (): Promise<FixtureWorld> => {
  const tag = randomUUID().slice(0, 8);
  const reader = await registerDisposableUser(`rreader_${tag}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_dev_${tag}`, PASSWORD);
  const roomId = await createPrivateRoom(DISPOSABLE_HOMESERVER, reader.accessToken, {
    name: `Room Timeline Jumps ${tag}`,
    topic: 'Realistic classic room timeline jump measurement fixture',
    invite: [agent.userId],
  });
  await joinRoom(DISPOSABLE_HOMESERVER, agent.accessToken, roomId);

  const imgSized = await uploadPng(agent.accessToken, 800, 520, 40);
  const imgUnsized = await uploadPng(agent.accessToken, 680, 560, 160);
  const sendInRoom = async (user: DisposableUser, content: Record<string, unknown>) => {
    await send(user, roomId, 'm.room.message', content);
  };

  for (let turn = 1; turn <= 56; turn += 1) {
    const body =
      turn % 3 === 0
        ? longCollapsibleText(turn)
        : `Turn #${turn}: check room scroll stability across collapsible messages and older history pages.`;
    await sendInRoom(reader, { msgtype: 'm.text', body });
    for (let step = 1; step <= 3; step += 1) {
      await sendInRoom(agent, {
        msgtype: 'm.text',
        body: `Step ${step}/3 for turn #${turn}: inspecting room scroll ledger measurements.\n`.repeat(
          4
        ),
        'io.mindroom.stream_status': 'completed',
      });
    }
    if (turn % 4 === 1) {
      const hasDims = turn % 8 === 1;
      await sendInRoom(agent, {
        msgtype: 'm.image',
        body: `screenshot-turn-${turn}.png`,
        url: hasDims ? imgSized : imgUnsized,
        info: hasDims ? { mimetype: 'image/png', w: 800, h: 520 } : { mimetype: 'image/png' },
      });
    }
    await sendInRoom(agent, longAgentAnswer(turn));
  }

  return { reader, agent, roomId };
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
  body: (page: Page) => Promise<void>
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

    await loginWithPassword(page, {
      homeserver: DISPOSABLE_HOMESERVER,
      username: fixture.reader.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({
      page,
      roomId: fixture.roomId,
      userId: fixture.reader.userId,
      viewMode: 'classic',
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

test.describe('room timeline jumps measurement', () => {
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

  const delayMediaAndMessages = async (
    page: Page,
    mediaMs: number,
    messagesMs: number,
    stats: { backPages: number }
  ) => {
    await routeQuietly(page, '**/_matrix/client/v1/media/**', async (route) => {
      await wait(mediaMs);
      await route.continue();
    });
    await routeQuietly(page, '**/_matrix/client/*/rooms/*/messages**', async (route) => {
      const url = route.request().url();
      if (url.includes('dir=b') && url.includes('from=')) {
        stats.backPages += 1;
        await wait(messagesMs);
      }
      await route.continue();
    });
  };

  const openRoomAtBottom = async (
    page: Page,
    fixture: FixtureWorld,
    stats: { backPages: number }
  ) => {
    await delayMediaAndMessages(page, 350, 650, stats);
    await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);

    const timeline = page.locator(ROOM_ROWS);
    await expect(timeline).toBeVisible({ timeout: 30_000 });
    await expect(timeline.getByText('Turn #56 summary', { exact: false })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(250);
  };

  type ContinuousWheelMetrics = {
    maxStuckAtTopMs: number;
    stuckAtTopOver500ms: boolean;
    prependsDuringWheel: number;
    prependedRowsDuringWheel: number;
    canLoadOlderAtWheelEnd: boolean;
    scrollTopAtWheelEnd: number;
  };

  const startContinuousWheelMonitor = (page: Page) =>
    page.evaluate(() => {
      type Monitor = {
        active: boolean;
        rafId: number;
        atZeroSince: number | null;
        maxStuckAtTopMs: number;
        prependsDuringWheel: number;
        prependedRowsDuringWheel: number;
        prevIndexById: Map<string, number>;
        stop: () => ContinuousWheelMetrics;
      };
      const findScroller = (): HTMLElement | null => {
        const inner = document.querySelector<HTMLElement>(
          '[data-timeline-rows][data-testid="room-virtual-inner"]'
        );
        let cur: HTMLElement | null = inner?.parentElement ?? null;
        while (cur) {
          const style = getComputedStyle(cur);
          if (
            (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            cur.clientHeight > 0
          ) {
            return cur;
          }
          cur = cur.parentElement;
        }
        return null;
      };
      const sample = (monitor: Monitor, now: number) => {
        const scroller = findScroller();
        const inner = scroller?.querySelector<HTMLElement>(
          '[data-timeline-rows][data-testid="room-virtual-inner"]'
        );
        if (!scroller || !inner) return;
        const canLoadOlder = !!scroller.querySelector('[data-paginator-anchor="B"]');
        if (scroller.scrollTop <= 1 && canLoadOlder) {
          if (monitor.atZeroSince === null) {
            monitor.atZeroSince = now;
          } else {
            monitor.maxStuckAtTopMs = Math.max(monitor.maxStuckAtTopMs, now - monitor.atZeroSince);
          }
        } else {
          monitor.atZeroSince = null;
        }
        let maxShift = 0;
        const current = new Map<string, number>();
        inner.querySelectorAll<HTMLElement>(':scope > [data-index]').forEach((tile) => {
          const idx = Number(tile.getAttribute('data-index'));
          const id = tile.querySelector<HTMLElement>('[data-message-id]')?.dataset.messageId;
          if (!Number.isFinite(idx) || !id) return;
          current.set(id, idx);
          const prev = monitor.prevIndexById.get(id);
          if (prev !== undefined && idx > prev && idx - prev > maxShift) {
            maxShift = idx - prev;
          }
        });
        if (maxShift > 0) {
          monitor.prependsDuringWheel += 1;
          monitor.prependedRowsDuringWheel += maxShift;
        }
        current.forEach((idx, id) => {
          monitor.prevIndexById.set(id, idx);
        });
      };
      const monitor: Monitor = {
        active: true,
        rafId: 0,
        atZeroSince: null,
        maxStuckAtTopMs: 0,
        prependsDuringWheel: 0,
        prependedRowsDuringWheel: 0,
        prevIndexById: new Map(),
        stop: () => {
          monitor.active = false;
          cancelAnimationFrame(monitor.rafId);
          sample(monitor, performance.now());
          const scroller = findScroller();
          return {
            maxStuckAtTopMs: Math.round(monitor.maxStuckAtTopMs),
            stuckAtTopOver500ms: monitor.maxStuckAtTopMs > 500,
            prependsDuringWheel: monitor.prependsDuringWheel,
            prependedRowsDuringWheel: monitor.prependedRowsDuringWheel,
            canLoadOlderAtWheelEnd: !!scroller?.querySelector('[data-paginator-anchor="B"]'),
            scrollTopAtWheelEnd: Math.round(scroller?.scrollTop ?? -1),
          };
        },
      };
      const tick = (now: number) => {
        if (!monitor.active) return;
        sample(monitor, now);
        monitor.rafId = requestAnimationFrame(tick);
      };
      sample(monitor, performance.now());
      monitor.rafId = requestAnimationFrame(tick);
      (window as unknown as { __continuousWheelMonitor?: Monitor }).__continuousWheelMonitor =
        monitor;
    });

  const stopContinuousWheelMonitor = (page: Page): Promise<ContinuousWheelMetrics> =>
    page.evaluate(() =>
      (
        window as unknown as {
          __continuousWheelMonitor: { stop: () => ContinuousWheelMetrics };
        }
      ).__continuousWheelMonitor.stop()
    );

  SCROLL_SETUPS.forEach((setup) => {
    test(`${setup.engine} ${setup.viewport}: fast upward wheel scrolling through realistic room history does not jump`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRun(setup, baseURL, fixture, async (page) => {
        const stats = { backPages: 0 };
        await openRoomAtBottom(page, fixture, stats);

        const center = await getProbeScrollerCenter(page);
        await startProbe(page, 'scrollUp');
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
        const maxJumpMagPx = r.jumps.reduce((max, jump) => Math.max(max, jump.mag), 0);
        const summary = JSON.stringify({
          scrolledPx: r.scrolledPx,
          backPages: stats.backPages,
          maxReversalPx: r.maxReversalPx,
          maxUnexplainedPx: r.maxUnexplainedPx,
          maxSpreadPx: r.maxSpreadPx,
          maxJumpMagPx,
          lostPlaceFrames: r.lostPlaceFrames,
          topJumps: r.jumps.slice(0, 5),
        });
        console.log(`[room-jump-measure] ${setup.engine} ${setup.viewport}: ${summary}`);
        const msg = (label: string) => `${label}: ${summary}`;
        expect(r.scrolledPx, 'scrolled upward').toBeGreaterThan(10_000);
        expect(r.lostPlaceFrames, msg('lost place')).toBe(0);
        expect(r.maxReversalPx, msg('reversal jump')).toBeLessThanOrEqual(8);
        expect(r.maxUnexplainedPx, msg('unexplained jump')).toBeLessThanOrEqual(12);
        expect(r.maxSpreadPx, msg('row spread jump')).toBeLessThanOrEqual(4);
      });
    });

    test(`${setup.engine} ${setup.viewport}: continuous upward wheel without pauses through realistic room history`, async ({
      baseURL,
    }) => {
      const fixture = requireFixture(setup);
      await openAndRun(setup, baseURL, fixture, async (page) => {
        const stats = { backPages: 0 };
        await openRoomAtBottom(page, fixture, stats);

        const center = await getProbeScrollerCenter(page);
        await startProbe(page, 'scrollUp');
        await startContinuousWheelMonitor(page);
        await page.mouse.move(center.x, center.y);

        const startedAt = Date.now();
        let wheelTicks = 0;
        while (Date.now() - startedAt < 6_000) {
          const tickStart = Date.now();
          await page.mouse.wheel(0, -120);
          wheelTicks += 1;
          const remaining = 16 - (Date.now() - tickStart);
          if (remaining > 0) await page.waitForTimeout(remaining);
        }
        const wheelElapsedMs = Date.now() - startedAt;
        const backPagesDuringWheel = stats.backPages;
        const continuous = await stopContinuousWheelMonitor(page);

        await page.waitForTimeout(1_000);
        const scrollTopAfterSettle = await page.evaluate(() => {
          const inner = document.querySelector<HTMLElement>(
            '[data-timeline-rows][data-testid="room-virtual-inner"]'
          );
          let cur: HTMLElement | null = inner?.parentElement ?? null;
          while (cur) {
            const style = getComputedStyle(cur);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && cur.clientHeight > 0) {
              return Math.round(cur.scrollTop);
            }
            cur = cur.parentElement;
          }
          return -1;
        });
        const r = await stopProbe(page);
        const maxJumpMagPx = r.jumps.reduce((max, jump) => Math.max(max, jump.mag), 0);
        const summary = JSON.stringify({
          wheelTicks,
          wheelElapsedMs,
          scrolledPx: r.scrolledPx,
          backPagesDuringWheel,
          backPages: stats.backPages,
          ...continuous,
          scrollTopAfterSettle,
          maxReversalPx: r.maxReversalPx,
          maxUnexplainedPx: r.maxUnexplainedPx,
          maxSpreadPx: r.maxSpreadPx,
          maxJumpMagPx,
          lostPlaceFrames: r.lostPlaceFrames,
          topJumps: r.jumps.slice(0, 5),
        });
        console.log(`[room-continuous-wheel] ${setup.engine} ${setup.viewport}: ${summary}`);
        const msg = (label: string) => `${label}: ${summary}`;
        expect(r.scrolledPx, 'scrolled upward').toBeGreaterThan(1_000);
        expect(r.lostPlaceFrames, msg('lost place')).toBe(0);
        expect(r.maxReversalPx, msg('reversal jump')).toBeLessThanOrEqual(8);
        expect(r.maxUnexplainedPx, msg('unexplained jump')).toBeLessThanOrEqual(12);
        expect(r.maxSpreadPx, msg('row spread jump')).toBeLessThanOrEqual(4);
      });
    });
  });
});
