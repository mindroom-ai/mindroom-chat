import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

// A reader at the bottom of a thread watches an agent's reply finish. Every painted frame from the
// send to well after the finish keeps the newest row right above the composer's overlay: the
// finishing edit (reasoning folded, Stop and the typing line gone) opens no blank band under the
// reply and moves the thread no frame late, and the "Running" bar above the composer stays up
// between the tool calls of one reply instead of leaving and coming back.
//
// Each frame is read after its paint (a task posted from requestAnimationFrame runs after the
// frame's layout, ResizeObserver callbacks and paint), with the reply row, the overlay's top
// edge and the scroll position. Chromium and WebKit, a desktop and a phone, `#think` and `#multi`.
// STREAM_END_SHOTS names a directory for the Chromium screencast frames around the finish.
test.describe.configure({ timeout: 300_000 });

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts; scrollbars are shown, as for readers.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
// A gap under the newest row this much wider than the reader's own is a blank band (px).
const BLANK_BAND_PX = 8;
const SHOTS = process.env.STREAM_END_SHOTS;

type Scenario = { tag: '#think' | '#multi'; finished: (body: string) => boolean };
const SCENARIOS: Scenario[] = [
  { tag: '#think', finished: (body) => body.includes('the answer is') },
  { tag: '#multi', finished: (body) => body.includes('Finished multi') },
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
    const sample = (phase: Sample['phase']): Sample => {
      const inner = scroll.querySelector<HTMLElement>('[data-thread-count]');
      let row: HTMLElement | null = null;
      let rowBottom = -Infinity;
      inner?.querySelectorAll<HTMLElement>('[data-message-id]').forEach((element) => {
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
        rowId: (row as HTMLElement | null)?.dataset.messageId ?? null,
        rowTop: rect?.top ?? NaN,
        rowHeight: rect?.height ?? NaN,
        overlayTop: overlay?.getBoundingClientRect().top ?? NaN,
        scrollTop: scroll.scrollTop,
        scrollHeight: scroll.scrollHeight,
        clientHeight: scroll.clientHeight,
        listHeight: inner?.style.height ?? '',
        bar: dock?.querySelector('[role="region"]')?.getAttribute('aria-label') ?? null,
        typing: !!footer?.querySelector('[role="status"]'),
      };
    };
    const channel = new MessageChannel();
    channel.port1.onmessage = () => state.samples.push(sample('painted'));
    const frame = () => {
      if (state.stop) return;
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
  const painted = samples.filter((sample) => sample.phase === 'painted' && sample.rowId);
  const t0 = painted[0]?.t ?? 0;
  const at = (sample: Sample) => `${Math.round(sample.t - t0)} ms`;
  const blank = painted
    .filter((sample) => gapOf(sample) - baseline > BLANK_BAND_PX)
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
  await page.waitForTimeout(300);
  const samples = await stopSampling(page);
  const painted = samples.filter((sample) => sample.phase === 'painted' && sample.rowId);
  expect(painted.length, 'frames sampled while settled').toBeGreaterThan(3);
  return gapOf(painted[painted.length - 1]);
};

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
    const directory = join(SHOTS, testInfo.titlePath.slice(1).join(' ').replace(/[^\w.-]+/g, '-'));
    mkdirSync(directory, { recursive: true });
    frames
      .filter(({ wall }) => wall >= from && wall <= to)
      .forEach(({ wall, data }) =>
        writeFileSync(join(directory, `${Math.round(wall - from)}.png`), Buffer.from(data, 'base64'))
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
  const baseline = await currentGap(page);

  const saveShots = await screencast(page, testInfo);
  await startSampling(page);
  const sentAt = Date.now();
  await sendFromComposer(page, `${scenario.tag} ${word}`);
  const own = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.tester.userId && event.content.body === `${scenario.tag} ${word}`,
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
  // The finish settles: the typing line goes, then a while longer for anything that follows it.
  await expect(page.locator('[data-room-footer] [role="status"]')).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);
  const samples = await stopSampling(page);
  await saveShots?.(sentAt, Date.now());
  await testInfo.attach('frames.json', {
    body: JSON.stringify({ baseline, samples }),
    contentType: 'application/json',
  });
  const findings = judge(samples, baseline);
  await testInfo.attach('findings.json', {
    body: JSON.stringify(findings, null, 2),
    contentType: 'application/json',
  });
  expect(findings.blank, 'painted frames with a blank band under the newest row').toEqual([]);
  expect(findings.barReturns, 'the jobs bar left and came back during one reply').toEqual([]);
  expect(Math.abs(findings.finalGap - baseline)).toBeLessThanOrEqual(2);
  await expect(jump).toBeHidden();
};

const withWebKit = async (
  stack: AgentStack,
  phone: boolean,
  baseURL: string | undefined,
  run: (page: Page) => Promise<void>
) => {
  let browser: Browser | undefined;
  try {
    browser = await launchWebKit();
    const context = await browser.newContext({ viewport: DESKTOP, hasTouch: phone, baseURL });
    const page = await context.newPage();
    await routeClientConfig(page, stack);
    // Signed in at a desktop's width, where the account button that tells it is done shows.
    await signIn(page, stack);
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

for (const scenario of SCENARIOS) {
  test.describe(`a reply that finishes (${scenario.tag}) keeps a reader at the bottom pinned`, () => {
    test('Chromium, desktop', async ({ page, stack }, testInfo) => {
      await page.setViewportSize(DESKTOP);
      await watchReplyFinish(page, stack, scenario, testInfo);
    });

    test('Chromium, phone', async ({ browser, stack, testerStorageState, baseURL }, testInfo) => {
      await withChromiumPhone(browser, stack, testerStorageState, baseURL, (page) =>
        watchReplyFinish(page, stack, scenario, testInfo)
      );
    });

    for (const phone of [false, true]) {
      test(`WebKit, ${phone ? 'phone' : 'desktop'}`, async ({ stack, baseURL }, testInfo) => {
        test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
        await withWebKit(stack, phone, baseURL, (page) =>
          watchReplyFinish(page, stack, scenario, testInfo)
        );
      });
    }
  });
}
