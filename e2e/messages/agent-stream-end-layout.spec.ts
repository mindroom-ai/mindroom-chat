import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Browser, BrowserContext, CDPSession, Page, TestInfo } from '@playwright/test';
import {
  type AgentStack,
  expect,
  messageRow,
  openLobby,
  routeClientConfig,
  sendFromComposer,
  showThread,
  signIn,
  startThread,
  streamStatus,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
} from '../helpers/agentStack';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

// A reader at the bottom of a thread watches an agent's reply finish. Every painted frame from the
// send to well after the finish keeps the newest row right above the composer's overlay: the
// finishing edit (reasoning folded, Stop and the typing line gone) opens no blank band under the
// reply and moves the thread no frame late, and the "Running" bar above the composer stays up
// between the tool calls of one reply instead of leaving and coming back.
//
// Each frame is read after its paint (a task posted from requestAnimationFrame runs after the
// frame's layout, ResizeObserver callbacks and paint) and in its requestAnimationFrame, with the
// reply row, the overlay's top edge and the scroll position. Chromium and WebKit, a desktop and a phone, `#think` and `#multi`.
// STREAM_END_SHOTS names a directory for the Chromium screencast frames around the finish.
test.describe.configure({ timeout: 300_000 });

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
// A gap under the newest row this much wider than the reader's own is a blank band (px).
const BLANK_BAND_PX = 8;
const SHOTS = process.env.STREAM_END_SHOTS;

type Scenario = { tag: '#think' | '#multi'; finished: (body: string) => boolean };
const SCENARIOS: Scenario[] = [
  { tag: '#think', finished: (body) => body.includes('the answer is') },
  { tag: '#multi', finished: (body) => /Finished \W*multi/.test(body) },
];

/** One sample of the thread's bottom edge. */
type Sample = {
  /** Read in requestAnimationFrame (before the frame's layout), or after the frame painted. */
  phase: 'raf' | 'painted';
  t: number;
  rowId: string | null;
  rowTop: number;
  rowHeight: number;
  /** The top of whatever floats above the composer: the jobs dock, else the footer. */
  overlayTop: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  listHeight: string;
  bar: string | null;
  typing: boolean;
  /** DOM mutations in the timeline and footer since this frame's requestAnimationFrame. */
  mutations: number;
};

declare global {
  interface Window {
    streamEndSamples?: { samples: Sample[]; stop: boolean };
  }
}

/** Starts sampling every frame, before and after its paint, into window.streamEndSamples. */
const startSampling = (page: Page) =>
  page.evaluate(() => {
    let scroller = document.querySelector<HTMLElement>('[data-thread-count]')?.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) throw new Error('No thread scroller');
    const scroll = scroller;
    const state = { samples: [] as Sample[], stop: false };
    window.streamEndSamples = state;
    let mutations = 0;
    let mutationsAtFrame = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
    });
    const area = document.querySelector('[data-room-footer]')?.parentElement ?? document.body;
    observer.observe(area, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const sample = (phase: Sample['phase']): Sample => {
      const inner = scroll.querySelector<HTMLElement>('[data-thread-count]');
      // The newest row the reader sees: the lowest rendered row with a height (a notice such as
      // the thread's new title is a row without a message ID).
      let row: HTMLElement | null = null;
      let rowBottom = -Infinity;
      inner?.querySelectorAll<HTMLElement>(':scope > [data-index]').forEach((element) => {
        if (element.offsetHeight === 0) return;
        const { bottom } = element.getBoundingClientRect();
        if (bottom > rowBottom) {
          rowBottom = bottom;
          row = element;
        }
      });
      const rect = (row as HTMLElement | null)?.getBoundingClientRect();
      const footer = document.querySelector<HTMLElement>('[data-room-footer]');
      const dock = footer?.previousElementSibling as HTMLElement | null | undefined;
      const overlay = dock && dock.offsetHeight > 0 ? dock : footer;
      return {
        phase,
        t: performance.now(),
        rowId: row
          ? (row as HTMLElement)
              .querySelector('[data-message-id]')
              ?.getAttribute('data-message-id') ?? `row ${(row as HTMLElement).dataset.index}`
          : null,
        rowTop: rect?.top ?? NaN,
        rowHeight: rect?.height ?? NaN,
        overlayTop: overlay?.getBoundingClientRect().top ?? NaN,
        scrollTop: scroll.scrollTop,
        scrollHeight: scroll.scrollHeight,
        clientHeight: scroll.clientHeight,
        listHeight: inner?.style.height ?? '',
        bar: dock?.querySelector('[role="region"]')?.getAttribute('aria-label') ?? null,
        typing: !!footer?.querySelector('[role="status"]'),
        mutations: mutations - mutationsAtFrame,
      };
    };
    const channel = new MessageChannel();
    channel.port1.onmessage = () => state.samples.push(sample('painted'));
    const frame = () => {
      if (state.stop) {
        observer.disconnect();
        return;
      }
      mutationsAtFrame = mutations;
      state.samples.push(sample('raf'));
      channel.port2.postMessage(0);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

const stopSampling = (page: Page): Promise<Sample[]> =>
  page.evaluate(() => {
    const state = window.streamEndSamples;
    if (!state) return [];
    state.stop = true;
    return state.samples;
  });

const gapOf = (sample: Sample) => sample.overlayTop - (sample.rowTop + sample.rowHeight);

type Findings = { blank: string[]; barReturns: string[]; baseline: number; finalGap: number };

/** Painted frames with a blank band under the newest row, and returns of the jobs bar. */
const judge = (samples: Sample[], baseline: number): Findings => {
  const rows = samples.filter((sample) => sample.rowId);
  const painted = rows.filter((sample) => sample.phase === 'painted');
  const t0 = painted[0]?.t ?? 0;
  const at = (sample: Sample) => `${Math.round(sample.t - t0)} ms`;
  const isBlank = (sample: Sample) => gapOf(sample) - baseline > BLANK_BAND_PX;
  // A task that ran after a frame's paint and before its read (a sync response, say) shows a state
  // the frame never painted. The next frame then still has it before its layout and has repaired
  // it in that layout's ResizeObserver pass: such a state was never on screen.
  const neverPainted = (sample: Sample) => {
    const index = rows.indexOf(sample);
    const nextFrame = rows.slice(index + 1).find((next) => next.phase === 'raf');
    const nextPaint = rows.slice(index + 1).find((next) => next.phase === 'painted');
    return !!nextFrame && !!nextPaint && isBlank(nextFrame) && !isBlank(nextPaint);
  };
  const blank = painted
    .filter((sample) => isBlank(sample) && !neverPainted(sample))
    .map(
      (sample) =>
        `${at(sample)}: ${Math.round(gapOf(sample) - baseline)} px blank under ${sample.rowId}` +
        ` (row ${Math.round(sample.rowTop)}+${Math.round(sample.rowHeight)}, overlay ${Math.round(
          sample.overlayTop
        )}, scroll ${sample.scrollTop}/${sample.scrollHeight - sample.clientHeight}, list ${
          sample.listHeight
        })`
    );
  const barReturns: string[] = [];
  let seen = false;
  let goneAt: Sample | undefined;
  painted.forEach((sample) => {
    if (sample.bar && goneAt) barReturns.push(`gone at ${at(goneAt)}, back at ${at(sample)}`);
    if (sample.bar) {
      seen = true;
      goneAt = undefined;
    } else if (seen && !goneAt) goneAt = sample;
  });
  const last = painted[painted.length - 1];
  return { blank, barReturns, baseline, finalGap: last ? gapOf(last) : NaN };
};

/** The newest row's gap above the overlay, read now (the reader is at the bottom). */
const currentGap = async (page: Page): Promise<number> => {
  await startSampling(page);
  // A loaded machine paints few frames: wait for enough of them.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.streamEndSamples?.samples.filter((sample) => sample.phase === 'painted')
              .length ?? 0
        ),
      { timeout: 10_000 }
    )
    .toBeGreaterThan(3);
  const samples = await stopSampling(page);
  const painted = samples.filter((sample) => sample.phase === 'painted' && sample.rowId);
  expect(painted.length, 'frames sampled while settled').toBeGreaterThan(3);
  return gapOf(painted[painted.length - 1] as Sample);
};

/** Takes the reader to the very end of the thread, as dragging its scrollbar down would. */
const readerAtEnd = (page: Page) =>
  page.evaluate(() => {
    let scroller = document.querySelector<HTMLElement>('[data-thread-count]')?.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });

/** Saves the screencast frames from `from` to `to` (wall clock, ms). */
const screencast = async (page: Page, testInfo: TestInfo) => {
  if (!SHOTS || page.context().browser()?.browserType().name() !== 'chromium') return undefined;
  const session: CDPSession = await page.context().newCDPSession(page);
  const frames: { wall: number; data: string }[] = [];
  session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ wall: (metadata.timestamp ?? Date.now() / 1000) * 1000, data });
    session.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return async (from: number, to: number) => {
    await session.send('Page.stopScreencast');
    const directory = join(
      SHOTS,
      testInfo.titlePath
        .slice(1)
        .join(' ')
        .replace(/[^\w.-]+/g, '-')
    );
    mkdirSync(directory, { recursive: true });
    frames
      .filter(({ wall }) => wall >= from && wall <= to)
      .forEach(({ wall, data }) =>
        writeFileSync(
          join(directory, `${Math.round(wall - from)}.png`),
          Buffer.from(data, 'base64')
        )
      );
  };
};

const watchReplyFinish = async (
  page: Page,
  stack: AgentStack,
  scenario: Scenario,
  testInfo: TestInfo
) => {
  const word = uniqueWord('ending');
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${word} #long`);
  const long = await waitForAgentReply(stack, rootId, (body) =>
    body.includes('End of the long reply')
  );
  await showThread(page, stack, rootId);
  await expect(messageRow(page, long.event_id)).toContainText('End of the long reply', {
    timeout: 30_000,
  });
  const jump = page.getByRole('button', { name: 'Jump to Latest' });
  await expect(jump).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(1_500);
  // The opening pin can end a few px short when the newest row measures late; the reader starts
  // from the end.
  await readerAtEnd(page);
  await page.waitForTimeout(500);
  const baseline = await currentGap(page);

  const saveShots = await screencast(page, testInfo);
  await startSampling(page);
  const sentAt = Date.now();
  await sendFromComposer(page, `${scenario.tag} ${word}`);
  const own = await waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.tester.userId && event.content.body === `${scenario.tag} ${word}`,
    { description: 'the message just sent' }
  );
  const reply = await waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.agents.helper &&
      event.type === 'm.room.message' &&
      event.origin_server_ts > own.origin_server_ts &&
      streamStatus(event) === 'completed',
    { description: "the helper's finished reply", timeout: 120_000 }
  );
  expect(scenario.finished(String(reply.content.body))).toBe(true);
  const replyRow = messageRow(page, reply.event_id);
  await expect(replyRow).toBeVisible({ timeout: 30_000 });
  // The finish settles: the typing line goes, the jobs bar 2 s after the reply, then a while longer
  // for anything that follows them.
  await expect(page.locator('[data-room-footer] [role="status"]')).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.getByRole('region', { name: /run_shell_command/ })).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);
  const samples = await stopSampling(page);
  await saveShots?.(sentAt, Date.now());
  const findings = judge(samples, baseline);
  writeFileSync(testInfo.outputPath('frames.json'), JSON.stringify({ baseline, samples }));
  writeFileSync(testInfo.outputPath('findings.json'), JSON.stringify(findings, null, 2));
  expect(findings.blank, 'painted frames with a blank band under the newest row').toEqual([]);
  expect(findings.barReturns, 'the jobs bar left and came back during one reply').toEqual([]);
  expect(Math.abs(findings.finalGap - baseline)).toBeLessThanOrEqual(2);
  await expect(jump).toBeHidden();
};

/** WebKit's own signed-in storage, made by the first WebKit test of the stack and reused after it. */
const webKitState = (stack: AgentStack) => join(stack.dir, 'browser-state', 'tester-webkit.json');

const withWebKit = async (
  stack: AgentStack,
  phone: boolean,
  baseURL: string | undefined,
  run: (page: Page) => Promise<void>
) => {
  let browser: Browser | undefined;
  try {
    browser = await launchWebKit();
    const state = webKitState(stack);
    const signedIn = existsSync(state);
    const context = await browser.newContext({
      viewport: DESKTOP,
      hasTouch: phone,
      baseURL,
      storageState: signedIn ? state : undefined,
    });
    const page = await context.newPage();
    await routeClientConfig(page, stack);
    if (!signedIn) {
      // Signed in at a desktop's width, where the account button that tells it is done shows.
      await signIn(page, stack);
      mkdirSync(dirname(state), { recursive: true });
      await context.storageState({ path: state, indexedDB: true });
    }
    if (phone) await page.setViewportSize(PHONE);
    await run(page);
  } finally {
    await browser?.close();
  }
};

const withChromiumPhone = async (
  browser: Browser,
  stack: AgentStack,
  storageState: string | undefined,
  baseURL: string | undefined,
  run: (page: Page) => Promise<void>
) => {
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ viewport: PHONE, hasTouch: true, storageState, baseURL });
    const page = await context.newPage();
    await routeClientConfig(page, stack);
    await run(page);
  } finally {
    await context?.close();
  }
};

/** One frame's read of a reply's row and of the row after it. */
type PairSample = {
  phase: 'raf' | 'painted';
  t: number;
  bottom: number;
  nextTop: number;
  /** The rendered rows, for the record. */
  rows: number;
};

declare global {
  interface Window {
    pairSamples?: { samples: PairSample[]; stop: boolean };
  }
}

/** Reads, every frame before and after its paint, where the row of `eventId` ends and the next starts. */
const startPairSampling = (page: Page, eventId: string) =>
  page.evaluate((id) => {
    const state = { samples: [] as PairSample[], stop: false };
    window.pairSamples = state;
    const read = (phase: PairSample['phase']): PairSample => {
      const row = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
      const tiles = Array.from(
        document.querySelectorAll<HTMLElement>('[data-thread-count] > [data-index]')
      );
      const tile = tiles.find((candidate) => !!row && candidate.contains(row));
      // The row placed after it: the next one down from its top (an overlap keeps that order).
      const top = (candidate: Element) => candidate.getBoundingClientRect().top;
      const next = tile
        ? tiles
            .filter((candidate) => candidate.offsetHeight > 0 && top(candidate) > top(tile))
            .sort((a, b) => top(a) - top(b))[0]
        : undefined;
      return {
        phase,
        t: performance.now(),
        bottom: tile?.getBoundingClientRect().bottom ?? NaN,
        nextTop: next?.getBoundingClientRect().top ?? NaN,
        rows: tiles.length,
      };
    };
    const channel = new MessageChannel();
    channel.port1.onmessage = () => state.samples.push(read('painted'));
    const frame = () => {
      if (state.stop) return;
      state.samples.push(read('raf'));
      channel.port2.postMessage(0);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, eventId);

const stopPairSampling = (page: Page): Promise<PairSample[]> =>
  page.evaluate(() => {
    const state = window.pairSamples;
    if (!state) return [];
    state.stop = true;
    return state.samples;
  });

/**
 * A reply still streaming when the reader's next message arrives below it: as the reply grows,
 * the next row moves down with it in the same frame and never covers it (demo-F006).
 */
const watchRowAfterGrowingReply = async (page: Page, stack: AgentStack, testInfo: TestInfo) => {
  const word = uniqueWord('growing');
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${word} #long`);
  await waitForAgentReply(stack, rootId, (body) => body.includes('End of the long reply'));
  await showThread(page, stack, rootId);
  // A slow reply streams for several seconds, so it grows with the next row below it.
  await sendFromComposer(page, `#slow ${word}`);
  const own = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.tester.userId && event.content.body === `#slow ${word}`,
    { description: 'the message just sent' }
  );
  const reply = await waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.agents.helper &&
      event.type === 'm.room.message' &&
      event.origin_server_ts > own.origin_server_ts,
    { description: "the helper's streaming reply" }
  );
  const replyRow = messageRow(page, reply.event_id);
  await expect(replyRow).toContainText('word2', { timeout: 30_000 });
  await startPairSampling(page, reply.event_id);
  await sendFromComposer(page, `and one more thing ${word}`);
  await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.event_id === reply.event_id && streamStatus(event) === 'completed',
    { description: 'the long reply finished', timeout: 120_000 }
  );
  await expect(replyRow).toContainText('word30', { timeout: 30_000 });
  await page.waitForTimeout(1_000);
  const sampled = await stopPairSampling(page);
  writeFileSync(testInfo.outputPath('pairs.json'), JSON.stringify(sampled));
  const samples = sampled.filter((sample) => !Number.isNaN(sample.nextTop));
  const overlaps = (sample: PairSample) => sample.nextTop < sample.bottom - 1;
  // As for the blank band: a state a later task produced after the paint is not on screen.
  const painted = samples.filter((sample, index) => {
    if (sample.phase !== 'painted' || !overlaps(sample)) return false;
    const nextFrame = samples.slice(index + 1).find((next) => next.phase === 'raf');
    const nextPaint = samples.slice(index + 1).find((next) => next.phase === 'painted');
    return !(nextFrame && nextPaint && overlaps(nextFrame) && !overlaps(nextPaint));
  });
  const t0 = samples[0]?.t ?? 0;
  // The reply did grow while the row after it was there, so the check saw something.
  const bottoms = new Set(samples.map((sample) => Math.round(sample.bottom)));
  expect(bottoms.size, 'the reply grew with a row after it').toBeGreaterThan(2);
  expect(
    painted.map(
      (sample) =>
        `${Math.round(sample.t - t0)} ms: the next row starts ${Math.round(
          sample.bottom - sample.nextTop
        )} px inside the reply`
    ),
    'painted frames with the next row over the growing reply'
  ).toEqual([]);
};

type Watch = (page: Page, stack: AgentStack, testInfo: TestInfo) => Promise<void>;
const WATCHES: { title: string; watch: Watch }[] = [
  ...SCENARIOS.map((scenario) => ({
    title: `a reply that finishes (${scenario.tag}) keeps a reader at the bottom pinned`,
    watch: (page: Page, stack: AgentStack, testInfo: TestInfo) =>
      watchReplyFinish(page, stack, scenario, testInfo),
  })),
  { title: 'the row after a growing reply moves with it', watch: watchRowAfterGrowingReply },
];

for (const { title, watch } of WATCHES) {
  test.describe(title, () => {
    test('Chromium, desktop', async ({ page, stack }, testInfo) => {
      await page.setViewportSize(DESKTOP);
      await watch(page, stack, testInfo);
    });

    test('Chromium, phone', async ({ browser, stack, testerStorageState, baseURL }, testInfo) => {
      await withChromiumPhone(browser, stack, testerStorageState, baseURL, (page) =>
        watch(page, stack, testInfo)
      );
    });

    for (const phone of [false, true]) {
      test(`WebKit, ${phone ? 'phone' : 'desktop'}`, async ({ stack, baseURL }, testInfo) => {
        test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
        // A WebKit sign-in sets up a new device's encryption first, slow on a loaded machine.
        test.setTimeout(600_000);
        await withWebKit(stack, phone, baseURL, (page) => watch(page, stack, testInfo));
      });
    }
  });
}
