import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';
import {
  FULL_RIDE_BUDGETS,
  abortRelationsContinuations,
  analyzeRide,
  installScrollWriteProbe,
  recordOpenSettle,
  runFlickRide,
  throttleCpu,
  throttleRelationsContinuations,
} from '../helpers/rideRecorder';

/**
 * Environment-realism specs (2026-07-06 device regression class).
 *
 * The desktop e2e environment differs from the phone in exactly the ways
 * that hid the blank-screens regression: local fetches land pagination
 * commits neatly inside the first quiet pause (production takes seconds
 * and hits waitForScrollQuiescence's 2.5s force-commit cap mid-flick),
 * and an unthrottled CPU mounts a row batch in one frame (a phone takes
 * several — a visible blank band). These specs run the SAME full
 * invariant set as the momentum spec (coverage + anchor jumps + write
 * log) under injected relations latency and CDP CPU throttling.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const iphone = devices['iPhone 14'];

test.use({
  browserName: 'chromium',
  userAgent: iphone.userAgent,
  hasTouch: iphone.hasTouch,
  deviceScaleFactor: 2,
  viewport: { width: 1280, height: 800 },
});

const sendMixedThreadReplies = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  rootId: string,
  count: number
) => {
  for (let i = 1; i <= count; i += 1) {
    const isExtras = i % 5 === 0;
    const body =
      // eslint-disable-next-line no-nested-ternary
      isExtras
        ? `agent answer ${i}\n${Array.from(
            { length: 12 },
            (_v, line) => `streamed answer line ${line} of reply ${i} with wrapping text`
          ).join('\n')}`
        : i % 3 === 0
        ? `short reply ${i}`
        : `long reply ${i}\n${Array.from(
            { length: 24 },
            (_v, line) => `line ${line} of reply ${i} with enough text to wrap on a phone screen`
          ).join('\n')}`;
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, accessToken, roomId, {
      msgtype: 'm.text',
      body,
      ...(isExtras
        ? {
            'com.mindroom.message_extras': {
              version: 2,
              sections: [
                {
                  title: `Tool call ${i}.1`,
                  content_type: 'text/markdown',
                  content: `tool output for reply ${i}, section 1`,
                },
              ],
            },
          }
        : {}),
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }
};

test.describe('thread rides under production-shaped latency (iPhone-emulated, CPU-throttled)', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(600_000);

  test('continuous flicking while pagination fetches are slow: no blank bands, no jumps', async ({
    page,
  }, testInfo) => {
    // Device report (2026-07-06): "many more blank screens when scrolling
    // up, then the messages appear and jump slightly". The continuous
    // flicker never yields a 150ms quiet window, so the deferred prepend
    // commit lands via the 2.5s force-commit cap MID-FLICK, jumping the
    // scroll offset into freshly-prepended territory that a throttled CPU
    // takes several frames to mount.
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Latency ride ${Date.now()}`,
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'latency ride root',
    });
    await sendMixedThreadReplies(homeserver, session.accessToken, roomId, rootId, 360);

    // Partial window: the open's drain is cut off, leaving a live back
    // token — the state any long thread is in on a slow connection.
    const unrouteAbort = await abortRelationsContinuations(page);
    await installScrollWriteProbe(page);

    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
    await page.waitForTimeout(3_000);
    await unrouteAbort();

    // Production-shaped stream phase: pagination pages take 1.5s, the
    // phone CPU is ~4x slower than this desktop.
    await throttleRelationsContinuations(page, 1_500);
    await throttleCpu(page, 4);

    const report = await runFlickRide(page, {
      teleportTo: 1_800,
      teleportSettleMs: 800,
      // 90ms finger-back-down pauses: below the 150ms quiescence window,
      // so the ONLY way the fetched page can commit inside this stream is
      // the 2.5s cap — exactly the continuous-reader case. The tail keeps
      // sampling through the final quiescence so late commits are
      // measured too.
      cycles: Array.from({ length: 10 }, () => ({ steps: 8, stepPx: 90, pauseMs: 90 })),
      tailSampleMs: 3_000,
    });

    const analysis = analyzeRide(report, FULL_RIDE_BUDGETS);
    // eslint-disable-next-line no-console
    console.log(
      `LATENCY-RIDE ${JSON.stringify({
        threadCountStart: report.threadCountStart,
        threadCountEnd: report.threadCountEnd,
        probes: report.probes,
        frames: report.frames.length,
        maxGapPx: analysis.maxGapPx,
        maxJumpPx: analysis.maxJumpPx,
        totalJumpPx: analysis.totalJumpPx,
        appWrites: report.appWrites,
        violations: analysis.violations,
      })}`
    );
    if (report.jumpEvents.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`LATENCY-RIDE-JUMPS ${JSON.stringify(report.jumpEvents)}`);
    }
    await testInfo.attach('latency-ride.json', {
      body: JSON.stringify({ report, analysis }, null, 2),
      contentType: 'application/json',
    });

    expect(report.error).toBeUndefined();
    // Preconditions: the partial window really paginated inside the ride.
    expect(report.threadCountStart).toBeGreaterThan(0);
    expect(report.threadCountStart).toBeLessThan(360);
    expect(report.threadCountEnd).toBeGreaterThan(report.threadCountStart);
    // THE invariants — the full set, not a subset.
    expect(analysis.violations).toEqual([]);
  });

  test('hydrating a long thread keeps the view pinned to the bottom', async ({
    page,
  }, testInfo) => {
    // Device report (2026-07-06): "when I open a long thread that still
    // needs to be hydrated, I first end up at the bottom, then as more
    // messages load, it scrolls somewhere to the middle". No user input
    // at all: an open pinned to the latest message must STAY there while
    // the backfill grows content above it.
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `Hydration pin ${Date.now()}`,
    });
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'hydration pin root',
    });
    await sendMixedThreadReplies(homeserver, session.accessToken, roomId, rootId, 560);

    // The whole open runs against slow pagination pages and a throttled
    // CPU: the drain visibly hydrates for several seconds after first
    // paint, which is the window the device report describes.
    await throttleRelationsContinuations(page, 1_200);
    await installScrollWriteProbe(page);

    await loginWithPassword(page, { homeserver, username, password });
    await page.setViewportSize(iphone.viewport);
    await throttleCpu(page, 4);
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await page.waitForSelector('[data-message-item]', { timeout: 60_000 });

    const settle = await recordOpenSettle(page, 10_000);
    expect(settle.error).toBeUndefined();

    const PIN_GRACE_MS = 2_000;
    const start = settle.samples[0]?.t ?? 0;
    const afterGrace = settle.samples.filter((sample) => sample.t - start > PIN_GRACE_MS);
    const maxDistAfterGrace = Math.round(
      Math.max(0, ...afterGrace.map((sample) => sample.distFromBottom))
    );
    const finalDist = Math.round(settle.samples[settle.samples.length - 1]?.distFromBottom ?? -1);
    const threadCounts = settle.samples.map((sample) => sample.threadCount);
    const hydratedDuringWindow =
      (threadCounts[threadCounts.length - 1] ?? 0) > (threadCounts[0] ?? 0);

    // eslint-disable-next-line no-console
    console.log(
      `HYDRATION-PIN ${JSON.stringify({
        samples: settle.samples.length,
        threadCountFirst: threadCounts[0],
        threadCountLast: threadCounts[threadCounts.length - 1],
        hydratedDuringWindow,
        maxDistAfterGrace,
        finalDist,
      })}`
    );
    await testInfo.attach('hydration-pin.json', {
      body: JSON.stringify(settle, null, 2),
      contentType: 'application/json',
    });

    expect(settle.samples.length).toBeGreaterThan(100);
    // Precondition: hydration genuinely happened while we watched.
    expect(hydratedDuringWindow).toBe(true);
    // THE invariant: no input, so the view never leaves the bottom. A
    // "middle of the thread" landing is thousands of px; one viewport
    // (~850px logical) of tolerated transient still fails it.
    expect(maxDistAfterGrace).toBeLessThan(400);
    expect(finalDist).toBeLessThan(200);
  });
});
