import { chromium, expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  agentReply,
  buildBusyThreadRoom,
  instrumentScrolling,
  question,
  scrollRoom,
  send,
  startRecording,
  stopRecording,
  wait,
  type BusyThreadRoom,
  type ScrollInput,
} from '../helpers/busyThreadRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';
import { createDefaultThreadFilterState, seedRoomOverviewState } from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

/**
 * Scrolling a room with many agent threads (Bas, 2026-11-06: "jittery, and epileptic"). Every
 * animation frame of the reader's scroll is checked (e2e/helpers/busyThreadRoom.ts):
 *
 * - Compact, reading down the list at a slow pace: no card on screen changes its height, which a
 *   card did when its thread loaded half a second after it scrolled in and its title went from the
 *   question to the agent's one-line title; and the app never writes the scroll offset against
 *   the reader's scroll (WebKit undid wheel steps while the pointer held the cards' order).
 * - Threads view, newest first, scrolled down: new threads and replies land at the top, and the
 *   rows on screen stay where they are (they jumped down by the new row's height).
 *
 * Chromium and WebKit (when PLAYWRIGHT_WEBKIT_EXECUTABLE names it), desktop 1440x900 with the
 * wheel and phone 390x844 with touch (Chromium) or a finger's drag (WebKit), classic scrollbars,
 * 25 other rooms.
 */

const THREADS = 120;
const PASSWORD = 'thread-scroll-stability-password';

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

test.use({ trace: 'off', video: 'off' });

test.describe('scrolling a room with many agent threads', () => {
  test.setTimeout(10 * 60_000);
  let world: BusyThreadRoom | undefined;

  test.beforeAll(async () => {
    test.setTimeout(5 * 60_000);
    if (!(await disposableHomeserverIsUp())) return;
    world = await buildBusyThreadRoom({ threads: THREADS, password: PASSWORD });
  });

  SETUPS.forEach(({ engine, viewport }) => {
    test(`${engine} ${viewport}: rows on screen stay still`, async ({ baseURL }) => {
      test.skip(!world, 'the disposable homeserver is not running');
      test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
      const room = world!;
      const browser: Browser =
        engine === 'webkit'
          ? await launchWebKit()
          : await chromium.launch(CHROMIUM_WITH_SCROLLBARS);
      try {
        const context = await browser.newContext({
          baseURL,
          locale: 'en-US',
          ...VIEWPORTS[viewport],
        });
        await context.addInitScript(instrumentScrolling);
        const page = await context.newPage();
        const cdp = engine === 'chromium' ? await context.newCDPSession(page) : undefined;
        const input: ScrollInput =
          viewport === 'desktop' ? 'wheel' : engine === 'chromium' ? 'touch' : 'drag';
        await loginWithPassword(page, {
          homeserver: DISPOSABLE_HOMESERVER,
          username: room.reader.username,
          password: PASSWORD,
        });
        const open = async (view: 'compact' | 'threaded') => {
          await seedRoomOverviewState({
            page,
            roomId: room.roomId,
            userId: room.reader.userId,
            viewMode: view,
            filterState: createDefaultThreadFilterState(),
          });
          await page.goto(`/home/${encodeURIComponent(room.roomId)}`);
        };

        await open('compact');
        const cards = page.locator('[data-compact-room-view="true"] [data-scroll-anchor]');
        await expect
          .poll(() => cards.count(), { timeout: 120_000 })
          .toBeGreaterThanOrEqual(THREADS);
        // The cards of the first screen load their threads.
        await page.waitForTimeout(3_000);
        const compactAt = await startRecording(page, 'compact', input === 'touch');
        await scrollRoom(page, cdp, input, compactAt, {
          flicks: 0,
          readingSteps: 12,
          backFlicks: 0,
        });
        const compact = await stopRecording(page);
        expect(compact.scrolled, 'the reader scrolled').toBeGreaterThan(1_500);
        expect(compact.heightChanges, 'cards that changed height on screen').toEqual([]);
        expect(compact.moves, 'cards that moved apart on screen').toEqual([]);
        expect(
          compact.writes.filter(
            (write) => Math.sign(write.value - write.from) === -compactAt.direction
          ),
          'scroll offset writes against the reader'
        ).toEqual([]);

        await open('threaded');
        await expect(page.locator('[data-message-item]').first()).toBeVisible({ timeout: 120_000 });
        await page.waitForTimeout(2_000);
        const threadsAt = await startRecording(page, 'threaded', input === 'touch');
        await scrollRoom(page, cdp, input, threadsAt, {
          flicks: 0,
          readingSteps: 6,
          backFlicks: 0,
        });
        await page.waitForTimeout(1_500);
        // Fresh frames from here: the reader rests while threads land at the top.
        await stopRecording(page);
        await startRecording(page, 'threaded', input === 'touch');
        const asker = room.peer;
        for (let index = 0; index < 3; index += 1) {
          const rootId = await send(asker, room.roomId, 'm.room.message', {
            msgtype: 'm.text',
            body: question(THREADS + 100 + index),
          });
          await agentReply(room.agents[index]!, room.roomId, rootId, rootId, THREADS + 100 + index);
          await wait(400);
        }
        // An agent answers in an older thread, which moves it to the top.
        const older = room.rootIds[Math.floor(THREADS / 2)]!;
        await agentReply(room.agents[3]!, room.roomId, older, older, THREADS + 200);
        await page.waitForTimeout(3_000);
        const threads = await stopRecording(page);
        expect(threads.moves, 'rows that moved while the reader rested').toEqual([]);
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
});
