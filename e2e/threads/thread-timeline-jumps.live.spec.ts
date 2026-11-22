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

type Setup = { engine: 'chromium' | 'webkit'; viewport: 'desktop' | 'phone' };
const SETUPS: Setup[] = [
  { engine: 'chromium', viewport: 'desktop' },
  { engine: 'chromium', viewport: 'phone' },
  { engine: 'webkit', viewport: 'desktop' },
  { engine: 'webkit', viewport: 'phone' },
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
  const extraCode = turn % 2 === 0 ? 36 : 16;
  const codeLines = Array.from(
    { length: extraCode },
    (_, i) =>
      `const step_${turn}_${i} = computeAnchorOffset(rows[${i}], scrollTop + inset - listTop);`
  ).join('\n');
  const tableRows = Array.from(
    { length: 6 },
    (_, i) =>
      `<tr><td>metric_${turn}_${i}</td><td>${120 + i * 37}px</td><td>verified</td></tr>`
  ).join('');
  const body = `🔧 bash [1]\n\nTurn #${turn} summary: checked ${turn * 3} frames across desktop and phone.\n\n\`\`\`ts\n${codeLines}\n\`\`\`\n\nEverything settled cleanly for turn #${turn}.`;
  const formattedBody = [
    `<p>🔧 <code>bash</code> [1]</p>`,
    `<p>Turn #${turn} summary: investigated layout and scroll measurements across desktop and phone viewports with folded intermediate steps, code blocks, and images.</p>`,
    `<pre><code class="language-ts">${codeLines}</code></pre>`,
    `<table><thead><tr><th>Metric</th><th>Delta</th><th>Status</th></tr></thead><tbody>${tableRows}</tbody></table>`,
    `<p>Follow-up notes for turn #${turn}: confirmed virtualizer measurements, offset ledger margin, and resize observer passes stayed aligned.</p>`,
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
          result_preview: `Found 14 matches across 6 files for turn ${turn}\n`.repeat(12),
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
  streamingThreadRootId: string;
  otherThreadRootId: string;
  longThreadEventCount: number;
};

const buildFixtureWorld = async (): Promise<FixtureWorld> => {
  const tag = randomUUID().slice(0, 8);
  const reader = await registerDisposableUser(`jreader_${tag}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_dev_${tag}`, PASSWORD);
  const roomId = await createPrivateRoom(DISPOSABLE_HOMESERVER, reader.accessToken, {
    name: `Timeline Jumps ${tag}`,
    topic: 'Realistic agent thread timeline jump investigation',
    invite: [agent.userId],
  });
  await joinRoom(DISPOSABLE_HOMESERVER, agent.accessToken, roomId);

  const imgSized = await uploadPng(agent.accessToken, 800, 520, 40);
  const imgUnsized = await uploadPng(agent.accessToken, 720, 480, 160);

  // Thread 1: Realistic long thread (~220+ primary events, 34 finished turns with folded
  // intermediate steps, long agent replies with tool traces + code blocks + tables,
  // collapsible user pastes, images with and without dimensions) -> requires multiple
  // real /relations back-pagination pages beyond the initial open!
  const longThreadRootId = await send(reader, roomId, 'm.room.message', {
    msgtype: 'm.text',
    body: `Investigate thread timeline jumps (${tag})`,
  });
  let lastId = longThreadRootId;
  let eventCount = 1;

  for (let turn = 1; turn <= 34; turn += 1) {
    const userBody =
      turn % 3 === 0
        ? longCollapsibleText(turn)
        : `Turn #${turn}: check the scroll behavior after loading older pages and tool folds.`;
    lastId = await send(reader, roomId, 'm.room.message', {
      msgtype: 'm.text',
      body: userBody,
      ...inThread(longThreadRootId, lastId),
    });
    eventCount += 1;

    // 3 intermediate agent messages -> folded behind TurnBreak by planThreadTurnFolds!
    for (let step = 1; step <= 3; step += 1) {
      lastId = await send(agent, roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: `Step ${step}/3 for turn #${turn}: inspecting timelineScrollLedgerController and checking measurements.\n`.repeat(
          4
        ),
        'io.mindroom.stream_status': 'completed',
        ...inThread(longThreadRootId, lastId),
      });
      eventCount += 1;
    }

    // Images with and without w/h metadata
    if (turn % 3 === 1) {
      const hasDims = turn % 2 === 0;
      lastId = await send(agent, roomId, 'm.room.message', {
        msgtype: 'm.image',
        body: `screenshot-turn-${turn}.png`,
        url: hasDims ? imgSized : imgUnsized,
        info: hasDims
          ? { mimetype: 'image/png', w: 800, h: 520 }
          : { mimetype: 'image/png' },
        ...inThread(longThreadRootId, lastId),
      });
      eventCount += 1;
    }

    // Final long agent reply (sent as pending then finalized with m.replace like real MindRoom!)
    const replyId = await send(agent, roomId, 'm.room.message', {
      msgtype: 'm.text',
      body: 'Thinking...',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Thinking...</p>',
      'io.mindroom.stream_status': 'pending',
      ...inThread(longThreadRootId, lastId),
    });
    const finalContent = longAgentAnswer(turn);
    await send(agent, roomId, 'm.room.message', {
      ...finalContent,
      body: `* ${finalContent.body}`,
      'm.new_content': finalContent,
      'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
    });
    lastId = replyId;
    eventCount += 2;
  }

  // Thread summary notice (populates thread banner title!)
  await send(agent, roomId, 'm.room.message', {
    msgtype: 'm.notice',
    body: 'Thread timeline scroll and opening jumps investigation',
    'io.mindroom.thread_summary': {
      version: 1,
      summary: 'Thread timeline scroll and opening jumps investigation',
      message_count: eventCount,
      generated_at: new Date().toISOString(),
      model: 'test',
    },
    ...inThread(longThreadRootId, lastId),
  });
  eventCount += 1;

  // Thread 2: Another thread for switching & streaming-on-open
  const streamingThreadRootId = await send(reader, roomId, 'm.room.message', {
    msgtype: 'm.text',
    body: `Streaming open thread (${tag})`,
  });
  let streamLast = streamingThreadRootId;
  for (let turn = 1; turn <= 5; turn += 1) {
    streamLast = await send(reader, roomId, 'm.room.message', {
      msgtype: 'm.text',
      body: `Streaming fixture turn ${turn}`,
      ...inThread(streamingThreadRootId, streamLast),
    });
    for (let step = 1; step <= 2; step += 1) {
      streamLast = await send(agent, roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: `Intermediate step ${step} of turn ${turn}`,
        'io.mindroom.stream_status': 'completed',
        ...inThread(streamingThreadRootId, streamLast),
      });
    }
    streamLast = await send(agent, roomId, 'm.room.message', {
      ...longAgentAnswer(100 + turn),
      ...inThread(streamingThreadRootId, streamLast),
    });
  }

  // Thread 3: Smaller thread
  const otherThreadRootId = await send(reader, roomId, 'm.room.message', {
    msgtype: 'm.text',
    body: `Other thread (${tag})`,
  });
  await send(agent, roomId, 'm.room.message', {
    ...longAgentAnswer(200),
    ...inThread(otherThreadRootId, otherThreadRootId),
  });

  return {
    reader,
    agent,
    roomId,
    longThreadRootId,
    streamingThreadRootId,
    otherThreadRootId,
    longThreadEventCount: eventCount,
  };
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
  dMargin: number;
  listHeight: number;
  dListHeight: number;
  scrollHeight: number;
  threadCount: number;
  bannerH: number;
  inputAge: number;
  visibleCount: number;
  rows: string[];
  heightChanges: string[];
};

type ProbeReport = {
  totalFrames: number;
  visibleFrames: number;
  hiddenFrames: number;
  scrolledPx: number;
  threadCountStart: number;
  threadCountEnd: number;
  turnBreaksSeen: number;
  writes: WriteEntry[];
  jumps: JumpFrame[];
  maxJumpPx: number;
  maxSpreadPx: number;
  maxReversalPx: number;
  maxBottomGapJumpPx: number;
};

const installThreadJumpProbe = () => {
  type RowSnap = { top: number; h: number; idx: string };
  const probe = {
    active: false,
    mode: 'open' as 'open' | 'scrollUp',
    driving: false,
    lastInput: 0,
    writeDelta: 0,
    scroller: null as HTMLElement | null,
    writes: [] as WriteEntry[],
    jumps: [] as JumpFrame[],
    totalFrames: 0,
    visibleFrames: 0,
    hiddenFrames: 0,
    scrolledPx: 0,
    threadCountStart: -1,
    threadCountEnd: -1,
    turnBreaksSeen: 0,
    maxJumpPx: 0,
    maxSpreadPx: 0,
    maxReversalPx: 0,
    maxBottomGapJumpPx: 0,
    prevRows: new Map<string, RowSnap>(),
    prevScrollTop: 0,
    prevMarginTop: 0,
    prevListHeight: 0,
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
      this.driving = false;
      this.writeDelta = 0;
      this.scroller = this.findScroller();
      this.writes = [];
      this.jumps = [];
      this.totalFrames = 0;
      this.visibleFrames = 0;
      this.hiddenFrames = 0;
      this.scrolledPx = 0;
      this.threadCountStart = -1;
      this.threadCountEnd = -1;
      this.turnBreaksSeen = 0;
      this.maxJumpPx = 0;
      this.maxSpreadPx = 0;
      this.maxReversalPx = 0;
      this.maxBottomGapJumpPx = 0;
      this.prevRows = new Map();
      this.prevScrollTop = this.scroller?.scrollTop ?? 0;
      this.prevMarginTop = 0;
      this.prevListHeight = 0;
      this.prevBottomGap = Number.NaN;
      this.hasVisibleBaseline = false;
    },
    stop(): ProbeReport {
      this.active = false;
      return {
        totalFrames: this.totalFrames,
        visibleFrames: this.visibleFrames,
        hiddenFrames: this.hiddenFrames,
        scrolledPx: Math.round(this.scrolledPx),
        threadCountStart: this.threadCountStart,
        threadCountEnd: this.threadCountEnd,
        turnBreaksSeen: this.turnBreaksSeen,
        writes: this.writes,
        jumps: this.jumps,
        maxJumpPx: Math.round(this.maxJumpPx),
        maxSpreadPx: Math.round(this.maxSpreadPx),
        maxReversalPx: Math.round(this.maxReversalPx),
        maxBottomGapJumpPx: Math.round(this.maxBottomGapJumpPx),
      };
    },
  };

  (window as unknown as { __threadJumpProbe: typeof probe }).__threadJumpProbe = probe;

  const recordWrite = (kind: string, el: unknown, value: number) => {
    if (!probe.active || probe.driving) return;
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
        stack: (new Error().stack ?? '').split('\n').slice(2, 9).join(' < '),
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
      if (!probe.scroller || !probe.scroller.isConnected) {
        probe.scroller = probe.findScroller();
      }
      const scroller = probe.scroller;
      const inner = scroller?.querySelector<HTMLElement>('[data-timeline-rows][data-thread-count]') ?? null;
      if (scroller && inner) {
        probe.totalFrames += 1;
        const hidden = getComputedStyle(inner).visibility === 'hidden';
        const threadCount = Number(inner.dataset.threadCount ?? -1);
        const turnBreaks = inner.querySelectorAll('[data-turn-break]').length;
        if (turnBreaks > probe.turnBreaksSeen) probe.turnBreaksSeen = turnBreaks;

        const scrollTop = scroller.scrollTop;
        const marginTop = Number.parseFloat(inner.style.marginTop || '0') || 0;
        const listHeight = Number.parseFloat(inner.style.height || '0') || 0;
        const banner = scroller.querySelector<HTMLElement>('[data-thread-header]');
        const bannerH = banner ? Math.round(banner.getBoundingClientRect().height) : 0;

        const appDelta = probe.writeDelta;
        probe.writeDelta = 0;

        if (hidden) {
          probe.hiddenFrames += 1;
        } else {
          probe.visibleFrames += 1;
          if (probe.threadCountStart < 0 && threadCount >= 0) {
            probe.threadCountStart = threadCount;
          }
          if (threadCount >= 0) probe.threadCountEnd = threadCount;

          const view = scroller.getBoundingClientRect();
          const current = new Map<string, RowSnap>();
          const moved: { id: string; idx: string; d: number }[] = [];
          const heightChanges: string[] = [];
          const allRows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-item]'));

          allRows.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.bottom <= view.top || rect.top >= view.bottom || rect.height === 0) return;
            const id = el.dataset.eventId || el.dataset.messageId || el.getAttribute('data-index') || '';
            const tile = el.closest<HTMLElement>('[data-index]');
            const idx = tile?.dataset.index ?? '?';
            if (!id) return;
            const snap: RowSnap = { top: rect.top, h: rect.height, idx };
            current.set(id, snap);
            const prev = probe.prevRows.get(id);
            if (!prev) return;
            const shown = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
            if (shown > 8 && prev.top < view.bottom - 8 && prev.top + prev.h > view.top + 8) {
              moved.push({ id, idx, d: snap.top - prev.top });
            }
            if (Math.abs(snap.h - prev.h) >= 2) {
              heightChanges.push(`#${idx}(${id.slice(0, 10)}):${Math.round(prev.h)}->${Math.round(snap.h)}`);
            }
          });

          const lastRow = allRows[allRows.length - 1];
          const bottomGapPx = lastRow
            ? Math.round(view.bottom - lastRow.getBoundingClientRect().bottom)
            : Number.NaN;

          if (probe.hasVisibleBaseline) {
            const dScroll = scrollTop - probe.prevScrollTop;
            const dMargin = marginTop - probe.prevMarginTop;
            const dListHeight = listHeight - probe.prevListHeight;
            const dBottomGap =
              Number.isFinite(bottomGapPx) && Number.isFinite(probe.prevBottomGap)
                ? bottomGapPx - probe.prevBottomGap
                : 0;
            probe.scrolledPx += Math.abs(dScroll);

            const ds = moved.map((m) => m.d).sort((a, b) => a - b);
            const median = ds.length > 0 ? (ds[Math.floor(ds.length / 2)] ?? 0) : 0;
            const spread = ds.length > 0 ? Math.max(...ds.map((d) => Math.abs(d - median))) : 0;
            const userScroll = dScroll - appDelta;
            const unexplained = ds.length > 0 ? median + userScroll : 0;
            const inputAge = now - probe.lastInput;

            const reasons: string[] = [];
            if (probe.mode === 'open') {
              if (Math.abs(median) >= 3) reasons.push(`rowMove(${Math.round(median)}px)`);
              if (spread >= 3) reasons.push(`spread(${Math.round(spread)}px)`);
              if (Math.abs(dBottomGap) >= 4) reasons.push(`bottomGap(${Math.round(dBottomGap)}px)`);
            } else {
              if (median <= -4) reasons.push(`reversal(${Math.round(median)}px)`);
              if (spread >= 4) reasons.push(`spread(${Math.round(spread)}px)`);
              if (Math.abs(unexplained) >= 6) {
                reasons.push(`unexplained(${Math.round(unexplained)}px)`);
              }
              if (inputAge > 350 && Math.abs(median) >= 4) {
                reasons.push(`quietMove(${Math.round(median)}px)`);
              }
            }

            if (spread > probe.maxSpreadPx) probe.maxSpreadPx = spread;
            if (median < 0 && -median > probe.maxReversalPx) probe.maxReversalPx = -median;
            if (Math.abs(dBottomGap) > probe.maxBottomGapJumpPx) {
              probe.maxBottomGapJumpPx = Math.abs(dBottomGap);
            }

            if (reasons.length > 0) {
              const jumpMag =
                probe.mode === 'open'
                  ? Math.max(Math.abs(median), spread, Math.abs(dBottomGap))
                  : Math.max(
                      median < 0 ? -median : 0,
                      spread,
                      Math.abs(unexplained),
                      inputAge > 350 ? Math.abs(median) : 0
                    );
              if (jumpMag > probe.maxJumpPx) probe.maxJumpPx = jumpMag;
              if (probe.jumps.length < 150) {
                probe.jumps.push({
                  t: Math.round(now),
                  frame: probe.visibleFrames,
                  mag: Math.round(jumpMag),
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
                  dMargin: Math.round(dMargin),
                  listHeight: Math.round(listHeight),
                  dListHeight: Math.round(dListHeight),
                  scrollHeight: Math.round(scroller.scrollHeight),
                  threadCount,
                  bannerH,
                  inputAge: Math.round(inputAge),
                  visibleCount: current.size,
                  rows: moved
                    .slice(0, 5)
                    .map((r) => `#${r.idx}(${r.id.slice(0, 8)}):${Math.round(r.d)}`),
                  heightChanges: heightChanges.slice(0, 5),
                });
              }
            }
          }

          probe.prevRows = current;
          probe.prevScrollTop = scrollTop;
          probe.prevMarginTop = marginTop;
          probe.prevListHeight = listHeight;
          probe.prevBottomGap = bottomGapPx;
          probe.hasVisibleBaseline = current.size > 0;
        }
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

const scrollUpFast = async (page: Page, cdp: CDPSession | undefined, setup: Setup) => {
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

  if (setup.viewport === 'desktop') {
    await page.mouse.move(center.x, center.y);
    // Sustained fast bursts with varying pauses (including 0ms continuous and 220ms/450ms pauses
    // to exercise quiescence settles, back-pagination commits, and boundary settles!)
    for (let burst = 0; burst < 18; burst += 1) {
      for (let notch = 0; notch < 16; notch += 1) {
        await page.mouse.wheel(0, -180);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(burst % 3 === 0 ? 500 : 180);
    }
    await page.waitForTimeout(1_200);
    return;
  }

  if (setup.engine === 'chromium' && cdp) {
    for (let burst = 0; burst < 18; burst += 1) {
      await cdp.send('Input.synthesizeScrollGesture', {
        x: Math.round(center.x),
        y: Math.round(center.y),
        yDistance: 1600,
        speed: 3800,
        gestureSourceType: 'touch',
        preventFling: false,
      });
      await page.waitForTimeout(burst % 3 === 0 ? 550 : 200);
    }
    await page.waitForTimeout(1_200);
    return;
  }

  // WebKit phone: fast touch drag bursts
  for (let burst = 0; burst < 18; burst += 1) {
    await page.evaluate(() =>
      new Promise<void>((resolve) => {
        const probe = (
          window as unknown as {
            __threadJumpProbe: { scroller: HTMLElement | null; driving: boolean; lastInput: number };
          }
        ).__threadJumpProbe;
        const scroller = probe.scroller;
        if (!scroller) {
          resolve();
          return;
        }
        const box = scroller.getBoundingClientRect();
        const finger = {
          identifier: 0,
          target: scroller,
          clientX: box.x + box.width / 2,
          clientY: box.y + box.height / 2,
        };
        const touch = (type: string) => {
          const touches = type === 'touchend' ? [] : [finger];
          scroller.dispatchEvent(
            Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
              touches,
              targetTouches: touches,
              changedTouches: [finger],
            })
          );
        };
        touch('touchstart');
        let left = 2200;
        let last = performance.now();
        const step = (now: number) => {
          const move = Math.min(left, Math.max(1, (now - last) * 3.5));
          last = now;
          left -= move;
          probe.driving = true;
          scroller.scrollTop = Math.max(0, scroller.scrollTop - move);
          probe.driving = false;
          probe.lastInput = now;
          if (left > 0 && scroller.scrollTop > 0) {
            touch('touchmove');
            requestAnimationFrame(step);
          } else {
            touch('touchend');
            resolve();
          }
        };
        requestAnimationFrame(step);
      })
    );
    await page.waitForTimeout(burst % 3 === 0 ? 550 : 200);
  }
  await page.waitForTimeout(1_200);
};

const summarize = (label: string, report: ProbeReport) => {
  const biggest = [...report.jumps].sort((a, b) => b.mag - a.mag).slice(0, 8);
  const biggestTimes = new Set(biggest.map((j) => j.t));
  const nearWrites = report.writes
    .filter((w) => Array.from(biggestTimes).some((t) => Math.abs(w.t - t) <= 80))
    .slice(0, 25);
  // eslint-disable-next-line no-console
  console.log(
    `JUMP-PROBE[${label}] ${JSON.stringify({
      totalFrames: report.totalFrames,
      visibleFrames: report.visibleFrames,
      hiddenFrames: report.hiddenFrames,
      scrolledPx: report.scrolledPx,
      threadCountStart: report.threadCountStart,
      threadCountEnd: report.threadCountEnd,
      turnBreaksSeen: report.turnBreaksSeen,
      jumpCount: report.jumps.length,
      maxJumpPx: report.maxJumpPx,
      maxSpreadPx: report.maxSpreadPx,
      maxReversalPx: report.maxReversalPx,
      maxBottomGapJumpPx: report.maxBottomGapJumpPx,
      writeCount: report.writes.length,
      biggestJumps: biggest,
      nearWrites,
    })}`
  );
};

test.use({ trace: 'off', video: 'off' });

test.describe('thread timeline jumps investigation', () => {
  test.setTimeout(8 * 60_000);
  let world: FixtureWorld | undefined;

  test.beforeAll(async () => {
    test.setTimeout(4 * 60_000);
    if (!(await disposableHomeserverIsUp())) return;
    world = await buildFixtureWorld();
  });

  SETUPS.forEach((setup) => {
    test(`${setup.engine} ${setup.viewport}: realistic thread open & fast scroll up`, async ({
      baseURL,
    }) => {
      test.skip(!world, 'disposable homeserver is not running');
      test.skip(
        setup.engine === 'webkit' && !WEBKIT_EXECUTABLE,
        'PLAYWRIGHT_WEBKIT_EXECUTABLE not set'
      );
      const fixture = world!;

      const browser =
        setup.engine === 'webkit'
          ? await launchWebKit()
          : await chromium.launch({
              executablePath: process.env.CHROMIUM_PATH || undefined,
              args: CHROMIUM_WITH_SCROLLBARS.args,
            });
      try {
        const context = await browser.newContext({
          ...VIEWPORTS[setup.viewport],
          baseURL,
        });
        const page = await context.newPage();
        await page.addInitScript(installThreadJumpProbe);
        const cdp =
          setup.engine === 'chromium' ? await context.newCDPSession(page) : undefined;

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

        // Add realistic latency to media downloads and /relations continuations
        await page.route('**/_matrix/client/v1/media/**', async (route) => {
          await wait(350);
          await route.continue();
        });
        await page.route('**/_matrix/media/**', async (route) => {
          await wait(350);
          await route.continue();
        });
        await page.route('**/relations/**', async (route) => {
          if (route.request().url().includes('from=')) {
            await wait(300);
          }
          await route.continue();
        });

        await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
        const longCard = page.locator(
          `[data-compact-room-view="true"] [data-thread-root-id="${fixture.longThreadRootId}"]`
        );
        await expect(longCard).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(800);

        // --- SCENARIO 1: Open realistic long thread from Compact view (cold open, phone slides!) ---
        await startProbe(page, 'open');
        await longCard.click();
        await expect(page.locator(THREAD_ROWS_SELECTOR)).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(2_500);
        const openReport = await stopProbe(page);
        summarize(`${setup.engine}-${setup.viewport}-open-cold`, openReport);

        // --- SCENARIO 2: Fast scroll UP through history (older pages, folded turns, images, collapsibles) ---
        await startProbe(page, 'scrollUp');
        await scrollUpFast(page, cdp, setup);
        const scrollReport = await stopProbe(page);
        summarize(`${setup.engine}-${setup.viewport}-scroll-up`, scrollReport);

        // --- SCENARIO 3: Open streaming thread while agent reply streams live edits ---
        await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
        const streamCard = page.locator(
          `[data-compact-room-view="true"] [data-thread-root-id="${fixture.streamingThreadRootId}"]`
        );
        await expect(streamCard).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(500);

        const liveReplyId = await send(fixture.agent, fixture.roomId, 'm.room.message', {
          msgtype: 'm.text',
          body: 'Thinking...',
          format: 'org.matrix.custom.html',
          formatted_body: '<p>Thinking...</p>',
          'io.mindroom.stream_status': 'streaming',
          ...inThread(fixture.streamingThreadRootId, fixture.streamingThreadRootId),
        });
        let streamRunning = true;
        const streamTask = (async () => {
          for (let i = 1; i <= 10 && streamRunning; i += 1) {
            await wait(160);
            const paras = Array.from(
              { length: i * 2 },
              (_, p) =>
                `<p>Streaming paragraph ${p + 1}: live tokens arriving during thread open.</p>`
            ).join('\n');
            const content = {
              msgtype: 'm.text',
              body: `Streaming chunk ${i}`,
              format: 'org.matrix.custom.html',
              formatted_body: paras,
              'io.mindroom.stream_status': i === 10 ? 'completed' : 'streaming',
            };
            await send(fixture.agent, fixture.roomId, 'm.room.message', {
              ...content,
              body: `* Streaming chunk ${i}`,
              'm.new_content': content,
              'm.relates_to': { rel_type: 'm.replace', event_id: liveReplyId },
            });
          }
        })();

        await startProbe(page, 'open');
        await streamCard.click();
        await expect(page.locator(THREAD_ROWS_SELECTOR)).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(2_500);
        streamRunning = false;
        await streamTask;
        const streamOpenReport = await stopProbe(page);
        summarize(`${setup.engine}-${setup.viewport}-open-streaming`, streamOpenReport);

        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});
