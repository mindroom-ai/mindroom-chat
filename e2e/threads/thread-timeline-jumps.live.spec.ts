import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { chromium, expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
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
 * The rows of a realistic agent thread (56 turns of folded steps, code, tables and images) keep
 * their places while it opens and while the reader scrolls up fast through its history. A probe in
 * the page compares every animation frame with the one before it: where the rows in view are, how
 * far the scroll position moved, and how much of that the page wrote itself.
 *
 * Opening (desktop and phone, Chromium and WebKit):
 * - The rows a folded turn hides were priced at their message estimate (about 190 px each) and
 *   sized as nothing after the render: the list was thousands of pixels too tall, the opening pin
 *   went to that end, and a frame showed no row (3,400 to 6,100 px).
 * - The render after rows are measured as they mount kept the list's old height: the pin and the
 *   ledger's settle scrolled to the end of that list, and the next render or the end clamp moved
 *   the rows it had shown (130 to 470 px back, 72 px on).
 *
 * Scrolling up (desktop):
 * - A page of older replies completes the turn at the top of the loaded rows. The row that drew
 *   that turn's break (42 px, unmeasured) folds away with it, priced at its message estimate for
 *   one render, and the ledger folded 148 px too much.
 * - WebKit scrolls a wheel on its scrolling thread. A settle of the offset ledger whose write has
 *   not reached that thread when the next notch does comes back as the position before it plus
 *   the notch: 496 px against a 736 px fold, which the discard watch took for motion from the
 *   settled position. virtual-core, which hears of the position first, rendered and measured the
 *   rows there without the fold, rows far above the reader, and their size changes moved the
 *   reader's rows for good (580 px).
 * - Some of those writes are not gone. WebKit applies them a few frames after it reported the old
 *   position, when the watch has put the fold back, and the rows moved by the fold once more
 *   (300 to 800 px, or to the end of the thread when the write was clamped there).
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
        body: `Step ${step}/3 for turn #${turn}: inspecting scroll ledger measurements.\n`.repeat(
          4
        ),
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

type ScrollWriteRecord = {
  api: 'scrollTop' | 'scrollTo' | 'scrollBy';
  from: number;
  to: number;
  delta: number;
  caller: string;
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
  anchorId?: string;
  anchorTop?: number;
  anchorDriftPx?: number;
  writes?: ScrollWriteRecord[];
};

type ColdFrameSample = {
  t: number;
  frame: number;
  threadCount: number;
  visibleCount: number;
  scrollTop: number;
  listHeight: number;
  marginTop: number;
  bottomGapPx: number;
  anchorId: string;
  anchorTop: number;
  anchorDriftPx: number;
  median: number;
  writes: ScrollWriteRecord[];
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
  maxAnchorDriftPx: number;
  lostPlaceFrames: number;
  jumps: JumpFrame[];
  coldFrames: ColdFrameSample[];
};

const installThreadJumpProbe = () => {
  type RowSnap = { top: number; h: number };
  const cacheDbs = new Set<IDBDatabase>();
  const origIdbTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function wrappedTransaction(
    this: IDBDatabase,
    storeNames: string | Iterable<string>,
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions
  ) {
    if (this.objectStoreNames.contains('events') && this.objectStoreNames.contains('meta')) {
      cacheDbs.add(this);
    }
    return origIdbTransaction.call(this, storeNames, mode, options);
  };

  const probe = {
    active: false,
    mode: 'open' as 'open' | 'scrollUp',
    stallMs: 0,
    writeDelta: 0,
    frameWrites: [] as ScrollWriteRecord[],
    wheelPx: 0,
    wheelAheadPx: 0,
    lastWrite: { px: 0, at: 0 },
    takenBackAt: Number.NEGATIVE_INFINITY,
    scroller: null as HTMLElement | null,
    jumps: [] as JumpFrame[],
    coldFrames: [] as ColdFrameSample[],
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
    maxAnchorDriftPx: 0,
    lostPlaceFrames: 0,
    anchorId: '',
    anchorBaseTop: Number.NaN,
    prevThreadCount: -1,
    prevListHeight: -1,
    prevRows: new Map<string, RowSnap>(),
    prevMounted: new Map<string, number>(),
    prevScrollTop: 0,
    prevBottomGap: Number.NaN,
    hasVisibleBaseline: false,
    async clearCacheStore(): Promise<number> {
      let cleared = 0;
      for (const db of Array.from(cacheDbs)) {
        try {
          const stores = ['events', 'meta'].filter((name) => db.objectStoreNames.contains(name));
          if (stores.length === 0) continue;
          await new Promise<void>((resolve, reject) => {
            const tx = origIdbTransaction.call(db, stores, 'readwrite');
            stores.forEach((name) => tx.objectStore(name).clear());
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
          cleared += 1;
        } catch {
          // Closed connection from a previous view; skip.
        }
      }
      return cleared;
    },
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
    start(mode: 'open' | 'scrollUp', stallMs = 0) {
      this.active = true;
      this.mode = mode;
      this.stallMs = stallMs;
      this.writeDelta = 0;
      this.frameWrites = [];
      this.wheelPx = 0;
      this.wheelAheadPx = 0;
      this.lastWrite = { px: 0, at: 0 };
      this.takenBackAt = Number.NEGATIVE_INFINITY;
      this.scroller = this.findScroller();
      this.jumps = [];
      this.coldFrames = [];
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
      this.maxAnchorDriftPx = 0;
      this.lostPlaceFrames = 0;
      this.anchorId = '';
      this.anchorBaseTop = Number.NaN;
      this.prevThreadCount = -1;
      this.prevListHeight = -1;
      this.prevRows = new Map();
      this.prevMounted = new Map();
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
        maxAnchorDriftPx: Math.round(this.maxAnchorDriftPx),
        lostPlaceFrames: this.lostPlaceFrames,
        jumps: this.jumps,
        coldFrames: this.coldFrames,
      };
    },
  };

  (window as unknown as { __threadJumpProbe: typeof probe }).__threadJumpProbe = probe;

  const extractCaller = (): string => {
    const raw = new Error().stack ?? '';
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          line !== 'Error' &&
          !line.includes('extractCaller') &&
          !line.includes('recordWrite') &&
          !line.includes('wrapped') &&
          !line.includes('set scrollTop')
      );
    return lines
      .slice(0, 3)
      .map((line) => line.replace(/https?:\/\/[^/]+/g, '').replace(/\?t=\d+/g, ''))
      .join(' <- ');
  };

  /** Counts a write of the thread's scroll position by the page; returns how far it asks to move. */
  const recordWrite = (
    el: unknown,
    value: number,
    api: ScrollWriteRecord['api']
  ): number => {
    if (!probe.active) return 0;
    if (!probe.scroller || !probe.scroller.isConnected) probe.scroller = probe.findScroller();
    if (!probe.scroller || el !== probe.scroller) return 0;
    const from = probe.scroller.scrollTop;
    const delta = value - from;
    probe.writeDelta += delta;
    if (probe.frameWrites.length < 12) {
      probe.frameWrites.push({
        api,
        from: Math.round(from),
        to: Math.round(value),
        delta: Math.round(delta),
        caller: extractCaller(),
      });
    }
    return delta;
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
        const delta = recordWrite(this, value, 'scrollTop');
        set.call(this, value);
        // The offset ledger settles with such a write and renders the rows after it, a frame of
        // 100 ms and more on a phone. The stall stands in for that frame: the reader's next wheel
        // reaches WebKit's scrolling thread before the write does.
        if (probe.stallMs > 0 && Math.abs(delta) >= 48) {
          const until = performance.now() + probe.stallMs;
          while (performance.now() < until) {
            // Keeps the main thread busy.
          }
        }
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
        recordWrite(this, name === 'scrollBy' ? this.scrollTop + top : top, name);
      }
      orig.apply(this, args);
    };
  });
  window.addEventListener(
    'wheel',
    (event) => {
      probe.wheelPx += event.deltaY;
    },
    { capture: true, passive: true }
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
        const writes = probe.frameWrites;
        probe.frameWrites = [];
        const wheelPx = probe.wheelPx;
        probe.wheelPx = 0;

        const view = scroller.getBoundingClientRect();
        const current = new Map<string, RowSnap>();
        const moved: number[] = [];
        // Rows mounted in this frame and the one before, in view or not, and where they were.
        const mounted = new Map<string, number>();
        const carried: { before: number; px: number }[] = [];
        const allRows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-item]'));
        allRows.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const id =
            el.dataset.eventId || el.dataset.messageId || el.getAttribute('data-index') || '';
          if (!id || rect.height === 0) return;
          mounted.set(id, rect.top);
          const before = probe.prevMounted.get(id);
          if (before !== undefined) carried.push({ before, px: rect.top - before });
          if (rect.bottom <= view.top || rect.top >= view.bottom) return;
          const snap: RowSnap = { top: rect.top, h: rect.height };
          current.set(id, snap);
          const prev = probe.prevRows.get(id);
          if (!prev) return;
          const shown = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
          if (shown > 8 && prev.top < view.bottom - 8 && prev.top + prev.h > view.top + 8) {
            moved.push(snap.top - prev.top);
          }
        });

        // A frame that shares no row in view with the one before (a long frame of wheel turns, or a
        // jump of more than the viewport) is measured by the row that was nearest the view and is
        // still mounted. With none of those either, the reader is at other rows altogether.
        const lostPlace =
          moved.length === 0 && carried.length === 0 && current.size > 0 && probe.prevRows.size > 0;
        if (moved.length === 0 && carried.length > 0) {
          const distance = (row: { before: number }) => Math.abs(row.before - view.top);
          moved.push(
            carried.reduce((near, row) => (distance(row) < distance(near) ? row : near)).px
          );
        }

        const lastRow = allRows[allRows.length - 1];
        const bottomGapPx = lastRow
          ? Math.round(view.bottom - lastRow.getBoundingClientRect().bottom)
          : Number.NaN;

        if (!probe.anchorId && current.size > 0) {
          // Track the newest visible row (last entry in DOM order) as the reader's anchor.
          const visibleIds = Array.from(current.keys());
          const chosenId = visibleIds[visibleIds.length - 1] ?? '';
          const chosenSnap = current.get(chosenId);
          if (chosenId && chosenSnap) {
            probe.anchorId = chosenId;
            probe.anchorBaseTop = chosenSnap.top - view.top;
          }
        }
        const anchorTopNow =
          probe.anchorId && mounted.has(probe.anchorId)
            ? mounted.get(probe.anchorId)! - view.top
            : Number.NaN;
        const anchorDriftPx =
          Number.isFinite(anchorTopNow) && Number.isFinite(probe.anchorBaseTop)
            ? anchorTopNow - probe.anchorBaseTop
            : Number.NaN;
        if (Number.isFinite(anchorDriftPx) && Math.abs(anchorDriftPx) > probe.maxAnchorDriftPx) {
          probe.maxAnchorDriftPx = Math.abs(anchorDriftPx);
        }

        if (probe.hasVisibleBaseline) {
          if (current.size < probe.minVisibleCount) probe.minVisibleCount = current.size;
          const dScroll = scrollTop - probe.prevScrollTop;
          const dBottomGap =
            Number.isFinite(bottomGapPx) && Number.isFinite(probe.prevBottomGap)
              ? bottomGapPx - probe.prevBottomGap
              : 0;
          probe.scrolledPx += Math.abs(dScroll);

          const ds = [...moved].sort((a, b) => a - b);
          const median = ds.length > 0 ? ds[Math.floor(ds.length / 2)] ?? 0 : 0;
          const spread = ds.length > 0 ? Math.max(...ds.map((d) => Math.abs(d - median))) : 0;
          // The reader only wheels up while the probe watches a scroll. A position that moves down
          // without a write of the page, or that moves back most of what the page last wrote, is
          // the browser taking a write back (WebKit discards one that a wheel overtakes): the
          // reader's part of that frame is what their wheel asked for and the rows have not
          // followed yet, as far as the rows moved. So it is for two seconds after that, while
          // WebKit may apply that write after all, or one made since.
          const movedPx = dScroll - appDelta;
          if (Math.abs(appDelta) >= 48) probe.lastWrite = { px: appDelta, at: now };
          const { lastWrite } = probe;
          const undone =
            now - lastWrite.at < 2_000 &&
            movedPx * lastWrite.px < 0 &&
            Math.abs(movedPx + lastWrite.px) <= Math.abs(lastWrite.px) / 2;
          if (undone) {
            probe.lastWrite = { px: 0, at: 0 };
            probe.takenBackAt = now;
          }
          const wheelAheadPx = wheelPx === 0 && movedPx === 0 ? 0 : probe.wheelAheadPx + wheelPx;
          const userScroll =
            probe.mode === 'scrollUp' && (movedPx > 0 || now - probe.takenBackAt < 2_000)
              ? -Math.min(-wheelAheadPx, Math.max(0, median))
              : movedPx;
          probe.wheelAheadPx = Math.min(0, wheelAheadPx - userScroll);
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
          if (lostPlace) probe.lostPlaceFrames += 1;

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
            if (lostPlace) reasons.push('lostPlace');
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
              anchorId: probe.anchorId || undefined,
              anchorTop: Number.isFinite(anchorTopNow) ? Math.round(anchorTopNow) : undefined,
              anchorDriftPx: Number.isFinite(anchorDriftPx) ? Math.round(anchorDriftPx) : undefined,
              writes: writes.length > 0 ? writes : undefined,
            });
          }

          const notableChange =
            threadCount !== probe.prevThreadCount ||
            Math.round(listHeight) !== probe.prevListHeight ||
            writes.length > 0 ||
            Math.abs(median) >= 4 ||
            Math.abs(dBottomGap) >= 10;
          if (notableChange && probe.coldFrames.length < 160) {
            probe.coldFrames.push({
              t: Math.round(now),
              frame: probe.visibleFrames,
              threadCount,
              visibleCount: current.size,
              scrollTop: Math.round(scrollTop),
              listHeight: Math.round(listHeight),
              marginTop: Math.round(marginTop),
              bottomGapPx: Number.isFinite(bottomGapPx) ? bottomGapPx : -9999,
              anchorId: probe.anchorId,
              anchorTop: Number.isFinite(anchorTopNow) ? Math.round(anchorTopNow) : -9999,
              anchorDriftPx: Number.isFinite(anchorDriftPx) ? Math.round(anchorDriftPx) : -9999,
              median: Math.round(median),
              writes,
            });
          }
        }

        probe.prevThreadCount = threadCount;
        probe.prevListHeight = Math.round(listHeight);
        probe.prevRows = current;
        probe.prevMounted = mounted;
        probe.prevScrollTop = scrollTop;
        probe.prevBottomGap = bottomGapPx;
        if (current.size > 0) probe.hasVisibleBaseline = true;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const startProbe = (page: Page, mode: 'open' | 'scrollUp', stallMs = 0) =>
  page.evaluate(
    ([m, stall]) => {
      (
        window as unknown as {
          __threadJumpProbe: { start: (mode: 'open' | 'scrollUp', stallMs: number) => void };
        }
      ).__threadJumpProbe.start(m, stall);
    },
    [mode, stallMs] as const
  );

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
          try {
            await wait(350);
            await route.continue();
          } catch {
            // Page closed while media request was delayed.
          }
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
        expect(
          report.minVisibleCount,
          `blank screen during thread open: ${summary}`
        ).toBeGreaterThan(0);
        expect(report.maxRowJumpPx, `row jump after reveal: ${summary}`).toBeLessThanOrEqual(4);
        expect(
          report.maxBottomGapJumpPx,
          `bottom-gap jump after reveal: ${summary}`
        ).toBeLessThanOrEqual(20);
      });
    });
  });

  const createColdThreadState = () => ({
    relationsPages: 0,
    relationsDone: false,
  });

  const setupColdThreadRoutes = async (
    page: Page,
    fixture: FixtureWorld,
    state: ReturnType<typeof createColdThreadState>
  ) => {
    const encodedRoot = encodeURIComponent(fixture.longThreadRootId);
    await page.route('**/_matrix/client/v1/media/**', async (route) => {
      try {
        await wait(350);
        await route.continue();
      } catch {
        // Page closed while media request was delayed.
      }
    });
    // Prevent background room /messages backfill from populating the thread's SDK timeline with
    // 200 events before/during the cold thread open.
    await page.route('**/_matrix/client/*/rooms/*/messages**', async (route) => {
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ chunk: [], start: '', end: '' }),
        });
      } catch {
        // Page closed.
      }
    });
    await page.route('**/relations/**', async (route) => {
      try {
        const url = new URL(route.request().url());
        // Match only the thread timeline pagination stream `/relations/<rootId>` (not sub-streams
        // like `/relations/<rootId>/m.thread/io.mindroom.tool_approval` or `/m.replace`).
        const isThreadTimelineRelations =
          url.pathname.endsWith(`/relations/${encodedRoot}`) ||
          url.pathname.endsWith(`/relations/${fixture.longThreadRootId}`);
        if (isThreadTimelineRelations) {
          url.searchParams.set('limit', '25');
          await wait(450);
          const response = await route.fetch({ url: url.toString() });
          const body = await response.text();
          state.relationsPages += 1;
          try {
            const parsed = JSON.parse(body) as { next_batch?: string };
            if (!parsed.next_batch) state.relationsDone = true;
          } catch {
            // Ignore non-JSON error responses.
          }
          await route.fulfill({ response, body });
          return;
        }
        await route.continue();
      } catch {
        // Page closed while an in-flight background /relations request was delayed.
      }
    });
  };

  OPEN_SETUPS.forEach((setup) => {
    test(`${setup.engine} ${setup.viewport}: cold open pinned to bottom across 10+ slow /relations pages does not jump`, async ({
      baseURL,
    }) => {
      test.skip(!world, 'disposable homeserver is not running');
      test.skip(
        setup.engine === 'webkit' && !WEBKIT_EXECUTABLE,
        'PLAYWRIGHT_WEBKIT_EXECUTABLE not set'
      );
      const fixture = world!;

      const net = createColdThreadState();
      await openAndRun(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
          const card = page.locator(
            `[data-compact-room-view="true"] [data-thread-root-id="${fixture.longThreadRootId}"]`
          );
          await expect(card).toBeVisible({ timeout: 30_000 });

          await page.evaluate(async () => {
            await (
              window as unknown as {
                __threadJumpProbe: { clearCacheStore: () => Promise<number> };
              }
            ).__threadJumpProbe.clearCacheStore();
          });


        await startProbe(page, 'open');
        await card.click();
        await expect(page.locator(THREAD_ROWS_SELECTOR)).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(() => net.relationsDone && net.relationsPages >= 10, { timeout: 60_000 })
          .toBe(true);
        await page.waitForTimeout(800);
        const report = await stopProbe(page);

        const summary = JSON.stringify({
          relationsPages: net.relationsPages,
          threadCountStart: report.threadCountStart,
          threadCountEnd: report.threadCountEnd,
          minVisibleCount: report.minVisibleCount,
          maxRowJumpPx: report.maxRowJumpPx,
          maxBottomGapJumpPx: report.maxBottomGapJumpPx,
          maxAnchorDriftPx: report.maxAnchorDriftPx,
          topJumps: report.jumps.slice(0, 12),
          coldFramesSample: report.coldFrames.slice(0, 30),
        });
        // eslint-disable-next-line no-console
        console.log(`[COLD-PINNED ${setup.engine} ${setup.viewport}]`, summary);
        expect(net.relationsPages, `expected 10+ /relations pages: ${summary}`).toBeGreaterThanOrEqual(10);
        expect(report.threadCountStart, `expected cold open start: ${summary}`).toBeLessThanOrEqual(40);
        expect(report.threadCountEnd, `expected full thread loaded: ${summary}`).toBeGreaterThanOrEqual(280);
        expect(report.visibleFrames, 'recorded visible cold-open frames').toBeGreaterThan(20);
        expect(
          report.minVisibleCount,
          `blank screen during cold open (pinned): ${summary}`
        ).toBeGreaterThan(0);
        expect(
          report.maxRowJumpPx,
          `row jump during cold open (pinned): ${summary}`
        ).toBeLessThanOrEqual(4);
        expect(
          report.maxBottomGapJumpPx,
          `bottom-gap jump during cold open (pinned): ${summary}`
        ).toBeLessThanOrEqual(20);
        expect(
          report.maxAnchorDriftPx,
          `anchor drift during cold open (pinned): ${summary}`
        ).toBeLessThanOrEqual(20);
        },
        (page) => setupColdThreadRoutes(page, fixture, net)
      );
    });

    test(`${setup.engine} ${setup.viewport}: cold open reading mid-thread while 10+ slow /relations pages arrive does not jump`, async ({
      baseURL,
    }) => {
      test.skip(!world, 'disposable homeserver is not running');
      test.skip(
        setup.engine === 'webkit' && !WEBKIT_EXECUTABLE,
        'PLAYWRIGHT_WEBKIT_EXECUTABLE not set'
      );
      const fixture = world!;

      const net = createColdThreadState();
      await openAndRun(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
          const card = page.locator(
            `[data-compact-room-view="true"] [data-thread-root-id="${fixture.longThreadRootId}"]`
          );
          await expect(card).toBeVisible({ timeout: 30_000 });

          await page.evaluate(async () => {
            await (
              window as unknown as {
                __threadJumpProbe: { clearCacheStore: () => Promise<number> };
              }
            ).__threadJumpProbe.clearCacheStore();
          });


        await card.click();
        await expect(page.locator(THREAD_ROWS_SELECTOR)).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(() => net.relationsPages, { timeout: 30_000 })
          .toBeGreaterThanOrEqual(2);
        await page.waitForTimeout(120);

        // Reader scrolls near the top of the initially loaded slice (just below where older pages
        // prepend and fold turns) while remaining ~10 pages continue arriving every 450 ms.
        const scrolledUp = await page.evaluate(() => {
          const inner = document.querySelector<HTMLElement>(
            '[data-timeline-rows][data-thread-count]'
          );
          let scroller = inner?.parentElement ?? null;
          while (scroller) {
            const { overflowY } = getComputedStyle(scroller);
            if (overflowY === 'auto' || overflowY === 'scroll') break;
            scroller = scroller.parentElement;
          }
          if (!scroller) return { ok: false, before: 0, after: 0 };
          scroller.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }));
          const before = scroller.scrollTop;
          const target = Math.min(Math.max(0, before - 600), 400);
          scroller.scrollTop = target;
          scroller.dispatchEvent(new Event('scroll', { bubbles: false }));
          return { ok: before - scroller.scrollTop >= 150, before, after: scroller.scrollTop };
        });
        await page.waitForTimeout(200);

        await startProbe(page, 'open');
        await expect
          .poll(() => net.relationsDone && net.relationsPages >= 10, { timeout: 60_000 })
          .toBe(true);
        await page.waitForTimeout(800);
        const report = await stopProbe(page);

        const summary = JSON.stringify({
          relationsPages: net.relationsPages,
          scrolledUp,
          threadCountStart: report.threadCountStart,
          threadCountEnd: report.threadCountEnd,
          minVisibleCount: report.minVisibleCount,
          maxRowJumpPx: report.maxRowJumpPx,
          maxBottomGapJumpPx: report.maxBottomGapJumpPx,
          maxAnchorDriftPx: report.maxAnchorDriftPx,
          topJumps: report.jumps.slice(0, 12),
          coldFramesSample: report.coldFrames.slice(0, 30),
        });
        // eslint-disable-next-line no-console
        console.log(`[COLD-MIDTHREAD ${setup.engine} ${setup.viewport}]`, summary);
        expect(scrolledUp.ok, `failed to scroll mid-thread: ${summary}`).toBe(true);
        expect(net.relationsPages, `expected 10+ /relations pages: ${summary}`).toBeGreaterThanOrEqual(10);
        expect(report.threadCountEnd, `expected full thread loaded: ${summary}`).toBeGreaterThanOrEqual(280);
        expect(report.visibleFrames, 'recorded visible mid-thread frames').toBeGreaterThan(20);
        expect(
          report.minVisibleCount,
          `blank screen during cold open (mid-thread): ${summary}`
        ).toBeGreaterThan(0);
        expect(
          report.maxRowJumpPx,
          `row jump during cold open (mid-thread): ${summary}`
        ).toBeLessThanOrEqual(4);
        expect(
          report.maxAnchorDriftPx,
          `anchor drift during cold open (mid-thread): ${summary}`
        ).toBeLessThanOrEqual(20);
        },
        (page) => setupColdThreadRoutes(page, fixture, net)
      );
    });

    test(`${setup.engine} ${setup.viewport}: cold open while reader scrolls/taps during 10+ slow /relations pages does not jump`, async ({
      baseURL,
    }) => {
      test.skip(!world, 'disposable homeserver is not running');
      test.skip(
        setup.engine === 'webkit' && !WEBKIT_EXECUTABLE,
        'PLAYWRIGHT_WEBKIT_EXECUTABLE not set'
      );
      const fixture = world!;

      const net = createColdThreadState();
      await openAndRun(
        setup,
        baseURL,
        fixture,
        async (page) => {
          await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
          const card = page.locator(
            `[data-compact-room-view="true"] [data-thread-root-id="${fixture.longThreadRootId}"]`
          );
          await expect(card).toBeVisible({ timeout: 30_000 });

          await page.evaluate(async () => {
            await (
              window as unknown as {
                __threadJumpProbe: { clearCacheStore: () => Promise<number> };
              }
            ).__threadJumpProbe.clearCacheStore();
          });


        await card.click();
        await expect(page.locator(THREAD_ROWS_SELECTOR)).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(() => net.relationsPages, { timeout: 30_000 })
          .toBeGreaterThanOrEqual(1);
        await page.waitForTimeout(100);

        const center = await page.evaluate(() => {
          const inner = document.querySelector<HTMLElement>(
            '[data-timeline-rows][data-thread-count]'
          );
          let scroller = inner?.parentElement ?? null;
          while (scroller) {
            const { overflowY } = getComputedStyle(scroller);
            if (overflowY === 'auto' || overflowY === 'scroll') break;
            scroller = scroller.parentElement;
          }
          const box = (scroller ?? document.body).getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        });

        await startProbe(page, 'scrollUp', 0);
        await page.mouse.move(center.x, center.y);
        // Reader gently reads/scrolls upward while pages 2..12 keep arriving every 450 ms.
        while (!net.relationsDone) {
          if (setup.engine === 'webkit' && setup.viewport === 'phone') {
            await page.evaluate(() => {
              const inner = document.querySelector<HTMLElement>(
                '[data-timeline-rows][data-thread-count]'
              );
              let scroller = inner?.parentElement ?? null;
              while (scroller) {
                const { overflowY } = getComputedStyle(scroller);
                if (overflowY === 'auto' || overflowY === 'scroll') break;
                scroller = scroller.parentElement;
              }
              if (!scroller) return;
              scroller.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, isPrimary: true })
              );
              scroller.scrollTop = Math.max(0, scroller.scrollTop - 120);
              scroller.dispatchEvent(new Event('scroll', { bubbles: false }));
            });
            await page.waitForTimeout(180);
          } else {
            for (let notch = 0; notch < 6; notch += 1) {
              await page.mouse.wheel(0, -120);
              await page.waitForTimeout(32);
            }
            await page.waitForTimeout(180);
          }
        }
        await page.waitForTimeout(800);
        const report = await stopProbe(page);

        const summary = JSON.stringify({
          relationsPages: net.relationsPages,
          scrolledPx: report.scrolledPx,
          threadCountStart: report.threadCountStart,
          threadCountEnd: report.threadCountEnd,
          minVisibleCount: report.minVisibleCount,
          maxRowJumpPx: report.maxRowJumpPx,
          maxReversalPx: report.maxReversalPx,
          maxUnexplainedPx: report.maxUnexplainedPx,
          maxSpreadPx: report.maxSpreadPx,
          lostPlaceFrames: report.lostPlaceFrames,
          topJumps: report.jumps.slice(0, 12),
          coldFramesSample: report.coldFrames.slice(0, 20),
        });
        // eslint-disable-next-line no-console
        console.log(`[COLD-ACTIVE ${setup.engine} ${setup.viewport}]`, summary);
        expect(net.relationsPages, `expected 10+ /relations pages: ${summary}`).toBeGreaterThanOrEqual(10);
        expect(report.lostPlaceFrames, `lost place during cold load: ${summary}`).toBe(0);
        expect(report.maxReversalPx, `reversal jump during cold load: ${summary}`).toBeLessThanOrEqual(8);
        expect(
          report.maxUnexplainedPx,
          `unexplained row jump during cold load: ${summary}`
        ).toBeLessThanOrEqual(12);
        expect(report.maxSpreadPx, `row spread jump during cold load: ${summary}`).toBeLessThanOrEqual(4);
        },
        (page) => setupColdThreadRoutes(page, fixture, net)
      );
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
          try {
            await wait(350);
            await route.continue();
          } catch {
            // Page closed while media request was delayed.
          }
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
          const inner = document.querySelector<HTMLElement>(
            '[data-timeline-rows][data-thread-count]'
          );
          let scroller = inner?.parentElement ?? null;
          while (scroller) {
            const { overflowY } = getComputedStyle(scroller);
            if (overflowY === 'auto' || overflowY === 'scroll') break;
            scroller = scroller.parentElement;
          }
          const box = (scroller ?? document.body).getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        });

        // The bursts pause for 220 ms or 450 ms: the ledger settles 150 ms into a pause, and the
        // stall after its write lasts into the next burst of the shorter ones.
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
        const report = await stopProbe(page);

        const summary = JSON.stringify({
          scrolledPx: report.scrolledPx,
          threadCountStart: report.threadCountStart,
          threadCountEnd: report.threadCountEnd,
          maxReversalPx: report.maxReversalPx,
          maxUnexplainedPx: report.maxUnexplainedPx,
          maxSpreadPx: report.maxSpreadPx,
          lostPlaceFrames: report.lostPlaceFrames,
          topJumps: report.jumps.slice(0, 5),
        });
        expect(report.scrolledPx, 'scrolled upward through thread').toBeGreaterThan(10_000);
        expect(
          report.lostPlaceFrames,
          `the reader lost their place during fast upward scroll: ${summary}`
        ).toBe(0);
        expect(
          report.maxReversalPx,
          `reversal jump during fast upward scroll: ${summary}`
        ).toBeLessThanOrEqual(8);
        expect(
          report.maxUnexplainedPx,
          `unexplained row jump during fast upward scroll: ${summary}`
        ).toBeLessThanOrEqual(12);
        expect(
          report.maxSpreadPx,
          `row spread jump during fast upward scroll: ${summary}`
        ).toBeLessThanOrEqual(4);
      });
    });
  });
});
