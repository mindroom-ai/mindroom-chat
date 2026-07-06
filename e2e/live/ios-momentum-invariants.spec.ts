import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';

/**
 * iOS momentum invariants for the virtualized thread timeline, in a real
 * rendered browser under iPhone emulation (chromium engine + iPhone UA /
 * touch / mobile viewport — the UA is what engages the iOS code paths in
 * both the app and virtual-core).
 *
 * iOS kills flick momentum on any programmatic scroll write during a live
 * scroll, and replayed corrections at quiescence land as a visible lurch.
 * The physics needs a device; the CAUSE is asserted here:
 *
 *  1. Zero app-originated scroll writes on the thread scroller while a
 *     scroll stream is live (momentum survives).
 *  2. No white gaps: virtual tiles cover the viewport core every frame of
 *     the stream (the PR #76 failure mode).
 *  3. No lurch: the visible anchor row does not jump when the stream ends
 *     (banked-replay failure mode, task #128 round 3).
 *
 * The scroll stream is driven by writes tagged via window.__driverDepth so
 * the instrumentation counts only writes the APP initiates.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = Number(process.env.IOS_INVARIANT_REPLY_COUNT ?? 220);
const iphone = devices['iPhone 14'];

type AppScrollWrite = { kind: string; value: number; t: number };

type StreamReport = {
  error?: string;
  startTop: number;
  streamEndTop: number;
  settledTop: number;
  travel: number;
  writesDuring: AppScrollWrite[];
  writesAfter: AppScrollWrite[];
  maxGapPx: number;
  gapFrames: number;
  anchorDriftPx: number | null;
};

test.use({
  browserName: 'chromium',
  userAgent: iphone.userAgent,
  hasTouch: iphone.hasTouch,
  deviceScaleFactor: 2,
  // Login happens at a desktop-sized viewport (the auth helpers assume the
  // desktop shell); the test resizes to iPhone dimensions before opening
  // the thread, same pattern as cinny073-recent-threads-mobile.
  viewport: { width: 1280, height: 800 },
});

test.describe('iOS momentum invariants (iPhone-emulated)', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(600_000);

  test('upward multi-flick stream: no app scroll writes, no white gaps, no end lurch', async ({
    page,
  }, testInfo) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `iOS momentum invariants ${Date.now()}`,
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'iOS momentum invariants root',
    });
    for (let i = 1; i <= REPLY_COUNT; i += 1) {
      // Mixed heights on purpose: short one-liners between long fold-worthy
      // walls of text, so fresh territory has real estimate error — the
      // condition every device report shared.
      const body =
        i % 3 === 0
          ? `short reply ${i}`
          : `long reply ${i}\n${Array.from(
              { length: 24 },
              (_v, line) => `line ${line} of reply ${i} with enough text to wrap on a phone screen`
            ).join('\n')}`;
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
    }

    // Instrumentation must exist before any app code runs: wrap the scroll
    // write surfaces and record app-originated writes on the (later marked)
    // thread scroller.
    await page.addInitScript(() => {
      const w = window as Window & {
        __appScrollWrites?: AppScrollWrite[];
        __driverDepth?: number;
      };
      type AppScrollWrite = { kind: string; value: number; t: number };
      w.__appScrollWrites = [];
      w.__driverDepth = 0;
      const record = (kind: string, el: unknown, value: number) => {
        if ((w.__driverDepth ?? 0) > 0) return;
        if (!(el instanceof HTMLElement) || el.dataset.e2eScroller !== '1') return;
        w.__appScrollWrites!.push({ kind, value, t: performance.now() });
      };
      const scrollTopDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      if (scrollTopDesc?.set && scrollTopDesc.get) {
        Object.defineProperty(Element.prototype, 'scrollTop', {
          configurable: true,
          get() {
            return scrollTopDesc.get!.call(this);
          },
          set(value: number) {
            record('scrollTop', this, value);
            scrollTopDesc.set!.call(this, value);
          },
        });
      }
      const wrapScrollMethod = (name: 'scrollTo' | 'scrollBy') => {
        const original = Element.prototype[name];
        Element.prototype[name] = function wrapped(this: Element, ...args: unknown[]) {
          const first = args[0];
          const top =
            typeof first === 'object' && first !== null
              ? (first as { top?: number }).top
              : (args[1] as number | undefined);
          if (typeof top === 'number') record(name, this, top);
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        } as typeof original;
      };
      wrapScrollMethod('scrollTo');
      wrapScrollMethod('scrollBy');
    });

    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    // Let the open-time pin/settle and initial backfill finish; the
    // invariants target the steady state a user scrolls in.
    await page.waitForTimeout(3_000);

    const report = (await page.evaluate(async () => {
      const w = window as Window & {
        __appScrollWrites?: { kind: string; value: number; t: number }[];
        __driverDepth?: number;
      };
      const row = document.querySelector('[data-message-item]');
      let candidate: HTMLElement | null = row?.parentElement ?? null;
      while (candidate) {
        const { overflowY } = getComputedStyle(candidate);
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          candidate.scrollHeight > candidate.clientHeight
        ) {
          break;
        }
        candidate = candidate.parentElement;
      }
      const scroller = candidate;
      if (!scroller) return { error: 'no scroller found' };
      scroller.dataset.e2eScroller = '1';

      const raf = () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, ms);
        });

      // Per-frame coverage sampler: max uncovered vertical span in the
      // viewport core (10%..90%) — a white gap is uncovered space.
      const gaps: number[] = [];
      let sampling = true;
      const sampleGaps = () => {
        if (!sampling) return;
        const rect = scroller.getBoundingClientRect();
        const top = rect.top + rect.height * 0.1;
        const bottom = rect.bottom - rect.height * 0.1;
        const tiles = Array.from(scroller.querySelectorAll('[data-index]'))
          .map((tile) => tile.getBoundingClientRect())
          .filter((r) => r.bottom > top && r.top < bottom)
          .sort((a, b) => a.top - b.top);
        let cursor = top;
        let maxGap = 0;
        tiles.forEach((r) => {
          if (r.top > cursor) maxGap = Math.max(maxGap, r.top - cursor);
          cursor = Math.max(cursor, r.bottom);
        });
        if (cursor < bottom) maxGap = Math.max(maxGap, bottom - cursor);
        gaps.push(maxGap);
        window.requestAnimationFrame(sampleGaps);
      };
      window.requestAnimationFrame(sampleGaps);

      const writes = w.__appScrollWrites!;
      const writesBefore = writes.length;
      const startTop = scroller.scrollTop;

      // Upward multi-flick stream: 3 flicks, 80ms finger-back-down pauses
      // (below the 150ms isScrolling debounce), driver-tagged writes.
      for (let flick = 0; flick < 3; flick += 1) {
        for (let step = 0; step < 14; step += 1) {
          w.__driverDepth! += 1;
          scroller.scrollTop -= 90;
          w.__driverDepth! -= 1;
          // eslint-disable-next-line no-await-in-loop
          await raf();
        }
        // eslint-disable-next-line no-await-in-loop
        await wait(80);
      }

      const streamEndTop = scroller.scrollTop;
      const writesDuring = writes.slice(writesBefore);
      const writesAtStreamEnd = writes.length;

      // Visible anchor at stream end: the row nearest the viewport centre.
      const pickAnchor = (): Element | null => {
        const rows = Array.from(document.querySelectorAll('[data-message-item]'));
        const mid = window.innerHeight / 2;
        let best: Element | null = null;
        let bestDistance = Infinity;
        rows.forEach((r) => {
          const rect = r.getBoundingClientRect();
          const distance = Math.abs((rect.top + rect.bottom) / 2 - mid);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = r;
          }
        });
        return best;
      };
      const anchor = pickAnchor();
      const anchorTopAtEnd = anchor?.getBoundingClientRect().top ?? null;

      // Quiescence: the banked-replay lurch (and the deferred prepend
      // commit) land inside this window if they are going to land at all.
      await wait(1_400);
      sampling = false;

      const anchorDriftPx =
        anchor && anchor.isConnected && anchorTopAtEnd !== null
          ? Math.abs(anchor.getBoundingClientRect().top - anchorTopAtEnd)
          : null;

      return {
        startTop,
        streamEndTop,
        settledTop: scroller.scrollTop,
        travel: startTop - streamEndTop,
        writesDuring,
        writesAfter: writes.slice(writesAtStreamEnd),
        maxGapPx: Math.round(Math.max(...gaps, 0)),
        gapFrames: gaps.length,
        anchorDriftPx,
      };
    })) as StreamReport;

    await testInfo.attach('ios-momentum-invariants.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    expect(report.error).toBeUndefined();
    // The stream really moved through fresh territory and was sampled.
    expect(report.travel).toBeGreaterThan(2_500);
    expect(report.gapFrames).toBeGreaterThan(40);

    // 1. Momentum invariant: the app wrote nothing to the scroller while
    // the stream was live — nothing to kill an iOS flick.
    expect(report.writesDuring).toEqual([]);

    // 2. White-gap invariant: tiles covered the viewport core every frame.
    expect(report.maxGapPx).toBeLessThan(120);

    // 3. Lurch invariant: the visible anchor stayed put across quiescence.
    // App writes MAY land here (anchor-restore, quiet-state corrections) —
    // they must be visually invisible, which is what the anchor measures.
    if (report.anchorDriftPx !== null) {
      expect(report.anchorDriftPx).toBeLessThan(60);
    }
  });

  test('scrolling up from the bottom stays up — no snap back while new replies stream in', async ({
    page,
  }, testInfo) => {
    // Device report 2026-07-06: thread opens pinned to the bottom
    // (correct), but scrolling up a bit on iOS snaps the view back to the
    // bottom. Reproduction: leave the bottom by a clear margin (~640px,
    // far beyond any sticky-bottom threshold), then let new replies land —
    // the view must stay where the user put it.
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `iOS snap-back repro ${Date.now()}`,
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'iOS snap-back root',
    });
    const sendReply = (body: string) =>
      sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
    for (let i = 1; i <= 60; i += 1) {
      const body =
        i % 3 === 0
          ? `short reply ${i}`
          : `long reply ${i}\n${Array.from(
              { length: 16 },
              (_v, line) => `line ${line} of reply ${i} with enough text to wrap on a phone`
            ).join('\n')}`;
      // eslint-disable-next-line no-await-in-loop
      await sendReply(body);
    }

    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    await page.waitForTimeout(3_000);

    // Leave the bottom with a driver-tagged upward stream and start a
    // scrollTop trajectory sampler.
    const scrollUp = await page.evaluate(async () => {
      const row = document.querySelector('[data-message-item]');
      let candidate: HTMLElement | null = row?.parentElement ?? null;
      while (candidate) {
        const { overflowY } = getComputedStyle(candidate);
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          candidate.scrollHeight > candidate.clientHeight
        ) {
          break;
        }
        candidate = candidate.parentElement;
      }
      const scroller = candidate;
      if (!scroller) return { error: 'no scroller found' };
      const w = window as Window & {
        __snapSamples?: { t: number; distFromBottom: number }[];
        __snapScroller?: HTMLElement;
        __snapSampling?: boolean;
      };
      w.__snapScroller = scroller;
      w.__snapSamples = [];
      w.__snapSampling = true;
      const sample = () => {
        if (!w.__snapSampling) return;
        w.__snapSamples!.push({
          t: performance.now(),
          distFromBottom: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
        });
        window.requestAnimationFrame(sample);
      };
      window.requestAnimationFrame(sample);

      const raf = () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
      const before = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      const scrollTopBefore = scroller.scrollTop;
      const scrollHeightBefore = scroller.scrollHeight;
      const steps: { scrollTop: number; scrollHeight: number }[] = [];
      for (let step = 0; step < 8; step += 1) {
        scroller.scrollTop -= 80;
        // eslint-disable-next-line no-await-in-loop
        await raf();
        steps.push({ scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight });
      }
      return {
        distFromBottomBefore: before,
        scrollTopBefore,
        scrollHeightBefore,
        steps,
        scrollTopAfterUp: scroller.scrollTop,
        scrollHeightAfterUp: scroller.scrollHeight,
        distFromBottomAfterUp:
          scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      };
    });
    // Diagnostic detail on failure: did scrollTop get written back down, or
    // did scrollHeight collapse under a fixed scrollTop (content teleport)?
    // eslint-disable-next-line no-console
    console.log(`IOS-SNAP-BACK-SCROLLUP ${JSON.stringify(scrollUp)}`);
    expect((scrollUp as { error?: string }).error).toBeUndefined();
    expect(
      (scrollUp as { distFromBottomAfterUp: number }).distFromBottomAfterUp
    ).toBeGreaterThan(500);

    // Streaming pressure: new replies land while the user is scrolled up.
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendReply(`streamed reply ${i} arriving while the user reads history`);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(2_000);

    const outcome = await page.evaluate(() => {
      const w = window as Window & {
        __snapSamples?: { t: number; distFromBottom: number }[];
        __snapScroller?: HTMLElement;
        __snapSampling?: boolean;
      };
      w.__snapSampling = false;
      const scroller = w.__snapScroller!;
      return {
        finalDistFromBottom:
          scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
        minDistAfterLeavingBottom: Math.min(
          ...w.__snapSamples!.slice(20).map((s) => s.distFromBottom),
          Infinity
        ),
        samples: w.__snapSamples!.length,
      };
    });

    await testInfo.attach('ios-snap-back.json', {
      body: JSON.stringify({ scrollUp, outcome }, null, 2),
      contentType: 'application/json',
    });

    // The view must stay where the user put it: never returning to the
    // bottom region without user input, including while replies land.
    expect(outcome.samples).toBeGreaterThan(40);
    expect(outcome.finalDistFromBottom).toBeGreaterThan(300);
    expect(outcome.minDistAfterLeavingBottom).toBeGreaterThan(150);
  });
});
