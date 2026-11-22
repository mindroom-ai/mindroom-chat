import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import {
  chromium,
  expect,
  test,
  type BrowserContextOptions,
  type CDPSession,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { send, wait } from '../helpers/busyThreadRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  seedRoomOverviewState,
} from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

/**
 * Reproduces the thread timeline scroll/opening jumps reported by Bas (2026-11-21/22):
 *
 * 1. Opening a realistic agent thread with folded turns (Desktop + Phone, Chromium + WebKit):
 *    - Reveal bounce (130-470px): `useRoomFocusScrollController` pins to `scrollHeight - clientHeight`
 *      ignoring `pendingListShrinkPx()` while `heldList` keeps old `listHeight`, then `useListEndClamp`
 *      pulls `scrollTop` back on the next frame.
 *    - Blank-screen jump (3,400-6,100px): `timelineRowSizing.estimateSize` prices `threadHiddenIds`
 *      at full message height (~190px each) instead of 0; `useThreadApprovalRowMeasurements` shrinks
 *      them via `resizeItem(i, 0)` while `useRoomFocusScrollController` pins to the inflated DOM
 *      `listHeight`, leaving 0 visible rows until the next frame.
 * 2. Fast scrolling up through a realistic agent thread:
 *    - WebKit Desktop reversal jump (730-790px): `waitForScrollQuiescence` (150ms) settles a large
 *      negative ledger between wheel bursts; WebKit's scrolling thread discards the settle write on
 *      the next upward wheel notch, and `isDiscardedSettleWrite` misses it because `|delta|` is
 *      reduced by `|wheeledPx|` below `0.8 * |px|`.
 *    - Chromium Desktop unexplained jump (~148px) when older folded history lands mid-scroll: an
 *      unmeasured row above the reader becomes a `TurnBreak` (`180px -> 32px`), which
 *      `planThreadLedgerRender` skips because the row already existed above the anchor.
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
const THREAD_ROWS_SELECTOR = '[data-timeline-rows][data-thread-count]';

const inThread = (rootId: string, replyTo: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: replyTo },
  },
});

const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i]!;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const makePng = (width: number, height: number, hue: number): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = (hue + x) % 256;
      raw[row + 2 + x * 3] = (y * 255) % 256;
      raw[row + 3 + x * 3] = 170;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const uploadPng = async (accessToken: string, width: number, height: number, hue: number) => {
  const res = await fetch(`${DISPOSABLE_HOMESERVER}/_matrix/media/v3/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/png' },
    body: makePng(width, height, hue),
  });
  const json = (await res.json()) as { content_uri: string };
  return json.content_uri;
};

const longCollapsibleText = (turn: number): string =>
  [
    `User detailed log paste for turn #${turn}:`,
    ...Array.from(
      { length: 48 },
      (_, line) =>
        `line ${line + 1}: worker=${turn} trace=0x${((turn * 100 + line) * 2654435761)
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
  const body = `🔧 bash [1]\n\nTurn #${turn} summary.\n\n\`\`\`ts\n${codeLines}\n\`\`\`\n\nDone for turn #${turn}.`;
  const formattedBody = [
    '<p>🔧 <code>bash</code> [1]</p>',
    `<p>Turn #${turn} summary: investigated layout and scroll measurements with folded steps, code blocks, and images.</p>`,
    `<pre><code class="language-ts">${codeLines}</code></pre>`,
    `<table><thead><tr><th>Metric</th><th>Delta</th><th>Status</th></tr></thead><tbody>${tableRows}</tbody></table>`,
    `<p>Follow-up notes for turn #${turn}.</p>`,
  ].join('\n');
  return {
    msgtype: 'm.text',
    body,
    format: 'org.matrix.custom.html',
    formatted_body: formattedBody,
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

  for (let turn = 1; turn <= 56; turn += 1) {
    const userBody =
      turn % 3 === 0
        ? longCollapsibleText(turn)
        : `Turn #${turn}: check scroll stability across folded turns and older history pages.`;
    lastId = await send(reader, roomId, 'm.room.message', {
      msgtype: 'm.text',
      body: userBody,
      ...inThread(longThreadRootId, lastId),
    });

    // 3 intermediate agent messages -> folded behind TurnBreak by planThreadTurnFolds
    for (let step = 1; step <= 3; step += 1) {
      lastId = await send(agent, roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: `Step ${step}/3 for turn #${turn}: inspecting scroll ledger measurements.\n`.repeat(4),
        'io.mindroom.stream_status': 'completed',
        ...inThread(longThreadRootId, lastId),
      });
    }

    if (turn % 4 === 1) {
      const hasDims = turn % 8 === 1;
      lastId = await send(agent, roomId, 'm.room.message', {
        msgtype: 'm.image',
        body: `screenshot-turn-${turn}.png`,
        url: hasDims ? imgSized : imgUnsized,
        info: hasDims ? { mimetype: 'image/png', w: 800, h: 520 } : { mimetype: 'image/png' },
        ...inThread(longThreadRootId, lastId),
      });
    }

    lastId = await send(agent, roomId, 'm.room.message', {
      ...longAgentAnswer(turn),
      ...inThread(longThreadRootId, lastId),
    });
  }

  await send(agent, roomId, 'm.room.message', {
    msgtype: 'm.notice',
    body: 'Realistic agent thread timeline jump regression',
    'io.mindroom.thread_summary': {
      version: 1,
      summary: 'Realistic agent thread timeline jump regression',
      message_count: 295,
      generated_at: new Date().toISOString(),
      model: 'test',
    },
    ...inThread(longThreadRootId, lastId),
  });

  return { reader, agent, roomId, longThreadRootId };
};

type WriteEntry = {
  kind: string;
  from: number;
  value: number;
  delta: number;
  t: number;
  stack: string;
};

type JumpFrame = {
  t: number;
  frame: number;
  mag: number;
  reasons: string[];
  scrollTop: number;
  dScroll: number;
  appDelta: number;
  median: number;
  spread: number;
  unexplained: number;
  dBottomGap: number;
  bottomGapPx: number;
  marginTop: number;
  listHeight: number;
  threadCount: number;
  visibleCount: number;
};

type ProbeReport = {
  visibleFrames: number;
  scrolledPx: number;
  threadCountStart: number;
  threadCountEnd: number;
  minVisibleCount: number;
  maxRowJumpPx: number;
  maxBottomGapJumpPx: number;
  maxReversalPx: number;
  maxUnexplainedPx: number;
  maxSpreadPx: number;
  jumps: JumpFrame[];
  writes: WriteEntry[];
};

const installThreadJumpProbe = () => {
  type RowSnap = { top: number; h: number };
  const probe = {
    active: false,
    mode: 'open' as 'open' | 'scrollUp',
    lastInput: 0,
    writeDelta: 0,
    scroller: null as HTMLElement | null,
    writes: [] as WriteEntry[],
    jumps: [] as JumpFrame[],
    visibleFrames: 0,
    scrolledPx: 0,
    threadCountStart: -1,
    threadCountEnd: -1,
    minVisibleCount: Number.POSITIVE_INFINITY,
    maxRowJumpPx: 0,
    maxBottomGapJumpPx: 0,
    maxReversalPx: 0,
    maxUnexplainedPx: 0,
    maxSpreadPx: 0,
    prevRows: new Map<string, RowSnap>(),
    prevScrollTop: 0,
    prevBottomGap: Number.NaN,
    hasVisibleBaseline: false,
    findScroller(): HTMLElement | null {
      const inner = document.querySelector<HTMLElement>('[data-timeline-rows][data-thread-count]');
      if (!inner) return null;
      let node = inner.parentElement;
      while (node) {
        const { overflowY } = getComputedStyle(node);
        if (overflowY === 'auto' || overflowY === 'scroll') return node;
        node = node.parentElement;
      }
      return null;
    },
    start(mode: 'open' | 'scrollUp') {
      this.active = true;
      this.mode = mode;
      this.writeDelta = 0;
      this.scroller = this.findScroller();
      this.writes = [];
      this.jumps = [];
      this.visibleFrames = 0;
      this.scrolledPx = 0;
      this.threadCountStart = -1;
      this.threadCountEnd = -1;
      this.minVisibleCount = Number.POSITIVE_INFINITY;
      this.maxRowJumpPx = 0;
      this.maxBottomGapJumpPx = 0;
      this.maxReversalPx = 0;
      this.maxUnexplainedPx = 0;
      this.maxSpreadPx = 0;
      this.prevRows = new Map();
      this.prevScrollTop = this.scroller?.scrollTop ?? 0;
      this.prevBottomGap = Number.NaN;
      this.hasVisibleBaseline = false;
    },
    stop(): ProbeReport {
      this.active = false;
      return {
        visibleFrames: this.visibleFrames,
        scrolledPx: Math.round(this.scrolledPx),
        threadCountStart: this.threadCountStart,
        threadCountEnd: this.threadCountEnd,
        minVisibleCount: Number.isFinite(this.minVisibleCount) ? this.minVisibleCount : 0,
        maxRowJumpPx: Math.round(this.maxRowJumpPx),
        maxBottomGapJumpPx: Math.round(this.maxBottomGapJumpPx),
        maxReversalPx: Math.round(this.maxReversalPx),
        maxUnexplainedPx: Math.round(this.maxUnexplainedPx),
        maxSpreadPx: Math.round(this.maxSpreadPx),
        jumps: this.jumps,
        writes: this.writes,
      };
    },
  };

  (window as unknown as { __threadJumpProbe: typeof probe }).__threadJumpProbe = probe;

  const recordWrite = (kind: string, el: unknown, value: number) => {
    if (!probe.active) return;
    if (!probe.scroller || !probe.scroller.isConnected) probe.scroller = probe.findScroller();
    if (!probe.scroller || el !== probe.scroller) return;
    const from = probe.scroller.scrollTop;
    const delta = value - from;
    probe.writeDelta += delta;
    if (probe.writes.length < 400) {
      probe.writes.push({
        kind,
        from: Math.round(from),
        value: Math.round(value),
        delta: Math.round(delta),
        t: Math.round(performance.now()),
        stack: (new Error().stack ?? '').split('\n').slice(2, 8).join(' < '),
      });
    }
  };

  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  if (desc?.get && desc.set) {
    const { get, set } = desc;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return get.call(this);
      },
      set(value: number) {
        recordWrite('scrollTop', this, value);
        set.call(this, value);
      },
    });
  }
  (['scrollTo', 'scrollBy'] as const).forEach((name) => {
    const orig = Element.prototype[name] as (...args: unknown[]) => void;
    Element.prototype[name] = function wrapped(this: Element, ...args: unknown[]) {
      const first = args[0];
      const top =
        typeof first === 'object' && first !== null ? (first as { top?: number }).top : args[1];
      if (typeof top === 'number') {
        recordWrite(name, this, name === 'scrollBy' ? this.scrollTop + top : top);
      }
      orig.apply(this, args);
    };
  });

  ['wheel', 'touchstart', 'touchmove', 'touchend', 'keydown'].forEach((type) =>
    window.addEventListener(
      type,
      () => {
        probe.lastInput = performance.now();
      },
      { capture: true, passive: true }
    )
  );

  const tick = (now: number) => {
    if (probe.active) {
      if (!probe.scroller || !probe.scroller.isConnected) probe.scroller = probe.findScroller();
      const scroller = probe.scroller;
      const inner =
        scroller?.querySelector<HTMLElement>('[data-timeline-rows][data-thread-count]') ?? null;
      if (scroller && inner && getComputedStyle(inner).visibility !== 'hidden') {
        probe.visibleFrames += 1;
        const threadCount = Number(inner.dataset.threadCount ?? -1);
        if (probe.threadCountStart < 0 && threadCount >= 0) probe.threadCountStart = threadCount;
        if (threadCount >= 0) probe.threadCountEnd = threadCount;

        const scrollTop = scroller.scrollTop;
        const marginTop = Number.parseFloat(inner.style.marginTop || '0') || 0;
        const listHeight = Number.parseFloat(inner.style.height || '0') || 0;
        const appDelta = probe.writeDelta;
        probe.writeDelta = 0;

        const view = scroller.getBoundingClientRect();
        const current = new Map<string, RowSnap>();
        const moved: number[] = [];
        const allRows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-item]'));
        allRows.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.bottom <= view.top || rect.top >= view.bottom || rect.height === 0) return;
          const id =
            el.dataset.eventId || el.dataset.messageId || el.getAttribute('data-index') || '';
          if (!id) return;
          const snap: RowSnap = { top: rect.top, h: rect.height };
          current.set(id, snap);
          const prev = probe.prevRows.get(id);
          if (!prev) return;
          const shown = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
          if (shown > 8 && prev.top < view.bottom - 8 && prev.top + prev.h > view.top + 8) {
            moved.push(snap.top - prev.top);
          }
        });

        const lastRow = allRows[allRows.length - 1];
        const bottomGapPx = lastRow
          ? Math.round(view.bottom - lastRow.getBoundingClientRect().bottom)
          : Number.NaN;

        if (probe.hasVisibleBaseline) {
          if (current.size < probe.minVisibleCount) probe.minVisibleCount = current.size;
          const dScroll = scrollTop - probe.prevScrollTop;
          const dBottomGap =
            Number.isFinite(bottomGapPx) && Number.isFinite(probe.prevBottomGap)
              ? bottomGapPx - probe.prevBottomGap
              : 0;
          probe.scrolledPx += Math.abs(dScroll);

          const ds = [...moved].sort((a, b) => a - b);
          const median = ds.length > 0 ? (ds[Math.floor(ds.length / 2)] ?? 0) : 0;
          const spread = ds.length > 0 ? Math.max(...ds.map((d) => Math.abs(d - median))) : 0;
          const userScroll = dScroll - appDelta;
          const unexplained = ds.length > 0 ? median + userScroll : 0;

          if (Math.abs(median) > probe.maxRowJumpPx) probe.maxRowJumpPx = Math.abs(median);
          if (Math.abs(dBottomGap) > probe.maxBottomGapJumpPx) {
            probe.maxBottomGapJumpPx = Math.abs(dBottomGap);
          }
          if (median < 0 && -median > probe.maxReversalPx) probe.maxReversalPx = -median;
          if (Math.abs(unexplained) > probe.maxUnexplainedPx) {
            probe.maxUnexplainedPx = Math.abs(unexplained);
          }
          if (spread > probe.maxSpreadPx) probe.maxSpreadPx = spread;

          const reasons: string[] = [];
          if (probe.mode === 'open') {
            if (Math.abs(median) >= 4) reasons.push(`rowMove(${Math.round(median)}px)`);
            if (Math.abs(dBottomGap) >= 10) reasons.push(`bottomGap(${Math.round(dBottomGap)}px)`);
            if (current.size === 0) reasons.push('blankScreen(0 rows)');
          } else {
            if (median <= -6) reasons.push(`reversal(${Math.round(median)}px)`);
            if (Math.abs(unexplained) >= 8) {
              reasons.push(`unexplained(${Math.round(unexplained)}px)`);
            }
            if (spread >= 4) reasons.push(`spread(${Math.round(spread)}px)`);
          }

          if (reasons.length > 0 && probe.jumps.length < 40) {
            const mag = Math.max(
              Math.abs(median),
              Math.abs(unexplained),
              spread,
              probe.mode === 'open' ? Math.abs(dBottomGap) : 0
            );
            probe.jumps.push({
              t: Math.round(now),
              frame: probe.visibleFrames,
              mag: Math.round(mag),
              reasons,
              scrollTop: Math.round(scrollTop),
              dScroll: Math.round(dScroll),
              appDelta: Math.round(appDelta),
              median: Math.round(median),
              spread: Math.round(spread),
              unexplained: Math.round(unexplained),
              dBottomGap: Math.round(dBottomGap),
              bottomGapPx: Number.isFinite(bottomGapPx) ? bottomGapPx : -9999,
              marginTop: Math.round(marginTop),
              listHeight: Math.round(listHeight),
              threadCount,
              visibleCount: current.size,
            });
          }
        }

        probe.prevRows = current;
        probe.prevScrollTop = scrollTop;
        probe.prevBottomGap = bottomGapPx;
        if (current.size > 0) probe.hasVisibleBaseline = true;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const startProbe = (page: Page, mode: 'open' | 'scrollUp') =>
  page.evaluate((m) => {
    (
      window as unknown as { __threadJumpProbe: { start: (mode: 'open' | 'scrollUp') => void } }
    ).__threadJumpProbe.start(m);
  }, mode);

const stopProbe = (page: Page): Promise<ProbeReport> =>
  page.evaluate(() =>
    (
      window as unknown as { __threadJumpProbe: { stop: () => ProbeReport } }
    ).__threadJumpProbe.stop()
  );

const openAndRun = async (
  setup: Setup,
  baseURL: string | undefined,
  fixture: FixtureWorld,
  body: (page: Page, cdp: CDPSession | undefined) => Promise<void>
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
    const cdp = setup.engine === 'chromium' ? await context.newCDPSession(page) : undefined;

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
    await body(page, cdp);
    await context.close();
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
    if (!(await disposableHomeserverIsUp())) return;
    world = await buildFixtureWorld();
  });

  OPEN_SETUPS.forEach((setup) => {
    test(`${setup.engine} ${setup.viewport}: opening a realistic folded-turn thread does not jump or flash blank`, async ({
      baseURL,
    }) => {
      test.skip(!world, 'disposable homeserver is not running');
      test.skip(
        setup.engine === 'webkit' && !WEBKIT_EXECUTABLE,
        'PLAYWRIGHT_WEBKIT_EXECUTABLE not set'
      );
      const fixture = world!;

      await openAndRun(setup, baseURL, fixture, async (page) => {
        await page.route('**/_matrix/client/v1/media/**', async (route) => {
          await wait(350);
          await route.continue();
        });
        await page.route('**/relations/**', async (route) => {
          if (route.request().url().includes('from=')) await wait(350);
          await route.continue();
        });

        await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
        const card = page.locator(
          `[data-compact-room-view="true"] [data-thread-root-id="${fixture.longThreadRootId}"]`
        );
        await expect(card).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(600);

        await startProbe(page, 'open');
        await card.click();
        await expect(page.locator(THREAD_ROWS_SELECTOR)).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(2_000);
        const report = await stopProbe(page);

        const summary = JSON.stringify({
          maxRowJumpPx: report.maxRowJumpPx,
          maxBottomGapJumpPx: report.maxBottomGapJumpPx,
          minVisibleCount: report.minVisibleCount,
          topJumps: report.jumps.slice(0, 4),
        });
        expect(report.visibleFrames, 'recorded visible open frames').toBeGreaterThan(20);
        expect(report.minVisibleCount, `blank screen during thread open: ${summary}`).toBeGreaterThan(0);
        expect(report.maxRowJumpPx, `row jump after reveal: ${summary}`).toBeLessThanOrEqual(4);
        expect(
          report.maxBottomGapJumpPx,
          `bottom-gap jump after reveal: ${summary}`
        ).toBeLessThanOrEqual(20);
      });
    });
  });

  SCROLL_SETUPS.forEach((setup) => {
    test(`${setup.engine} ${setup.viewport}: fast upward wheel scrolling through realistic history does not jump`, async ({
      baseURL,
    }) => {
      test.skip(!world, 'disposable homeserver is not running');
      test.skip(
        setup.engine === 'webkit' && !WEBKIT_EXECUTABLE,
        'PLAYWRIGHT_WEBKIT_EXECUTABLE not set'
      );
      const fixture = world!;

      await openAndRun(setup, baseURL, fixture, async (page) => {
        await page.route('**/_matrix/client/v1/media/**', async (route) => {
          await wait(350);
          await route.continue();
        });
        await page.route('**/relations/**', async (route) => {
          if (route.request().url().includes('from=')) await wait(650);
          await route.continue();
        });

        await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
        const card = page.locator(
          `[data-compact-room-view="true"] [data-thread-root-id="${fixture.longThreadRootId}"]`
        );
        await expect(card).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(600);

        await card.click();
        await expect(page.locator(THREAD_ROWS_SELECTOR)).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(async () => page.locator('[data-message-item]').count(), { timeout: 15_000 })
          .toBeGreaterThan(0);
        await page.waitForTimeout(250);

        const center = await page.evaluate(() => {
          const inner = document.querySelector<HTMLElement>('[data-timeline-rows][data-thread-count]');
          let scroller = inner?.parentElement ?? null;
          while (scroller) {
            const { overflowY } = getComputedStyle(scroller);
            if (overflowY === 'auto' || overflowY === 'scroll') break;
            scroller = scroller.parentElement;
          }
          const box = (scroller ?? document.body).getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        });

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
        const report = await stopProbe(page);

        const summary = JSON.stringify({
          scrolledPx: report.scrolledPx,
          threadCountStart: report.threadCountStart,
          threadCountEnd: report.threadCountEnd,
          maxReversalPx: report.maxReversalPx,
          maxUnexplainedPx: report.maxUnexplainedPx,
          maxSpreadPx: report.maxSpreadPx,
          topJumps: report.jumps.slice(0, 5),
        });
        expect(report.scrolledPx, 'scrolled upward through thread').toBeGreaterThan(10_000);
        expect(report.maxReversalPx, `reversal jump during fast upward scroll: ${summary}`).toBeLessThanOrEqual(8);
        expect(
          report.maxUnexplainedPx,
          `unexplained row jump during fast upward scroll: ${summary}`
        ).toBeLessThanOrEqual(12);
        expect(report.maxSpreadPx, `row spread jump during fast upward scroll: ${summary}`).toBeLessThanOrEqual(4);
      });
    });
  });
});
