import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Dragging the splitter of the members panel wraps every message of the room beside it anew. A
// reader at the newest message keeps it where it is, above the composer, in every frame the
// browser paints: the timeline used to pin it again a frame late, so the text jumped by the lines
// the message gained or lost and back. A reader up in the history sees the rows in view wrap in
// place: no frame shows the message at the top of their view anywhere but where the frames around
// it do, and it is back in its place when the room has its width back. The drag raises no
// "ResizeObserver loop completed with undelivered notifications." error. Runs in Chromium and,
// when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const PASSWORD = 'splitter-drag-spec-password';
const RUN = Date.now().toString(36);
const DESKTOP = { width: 1440, height: 900 };
const MESSAGES = 48;
/** How far the splitter travels, in px: the room narrows by as much and widens again. */
const TRAVEL = 220;
const STEPS = 44;
/** How far a message may sit from its place in a frame, in px. */
const TOLERANCE = 1;

type Account = MatrixSession & { username: string };

// Accounts stay unique when a run repeats a test in the same worker.
let accounts = 0;
const register = async (name: string): Promise<Account> => {
  accounts += 1;
  return registerDisposableUser(`sdk_${name}_${RUN}_${accounts}`, PASSWORD);
};

const NOTE = 'The ferry timetable lists every crossing, the tide at each pier and the spare boat. ';

/** A room of messages that wrap over one to many lines, the newest a long one. */
const seedRoom = async (name: string) => {
  const reader = await register(`${name}_reader`);
  const writer = await register(`${name}_writer`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Ferry desk ${name} ${RUN}`,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  let newest = '';
  for (let index = 1; index <= MESSAGES; index += 1) {
    const who = index % 3 === 0 ? reader : writer;
    const lines = index === MESSAGES ? 5 : index % 6;
    const body = `Crossing ${index}: ${lines === 0 ? 'on time.' : NOTE.repeat(lines)}`;
    // eslint-disable-next-line no-await-in-loop
    newest = await sendRoomMessage(HOMESERVER, who.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
  }
  return { reader, roomId, newest };
};

type Drag = {
  /** The message's distance from its edge of the scroll area in each frame, as painted, in px. */
  places: number[];
  /** The scroll area's narrowest and widest width during the drag, in px. */
  widths: [number, number];
  loops: string[];
};
type ProbeWindow = Window & { splitterDragProbe?: { stop: () => Drag } };

/**
 * Starts reading where a message sits in each frame: its bottom edge above the scroll area's
 * (`bottom`), or its top edge below the scroll area's (`top`). A frame's place is its last
 * reading: the one of a ResizeObserver created after the timeline's own, which runs after them
 * in each pass of the frame and so reads what the frame paints, or, in a frame that resizes
 * nothing, the one of its animation frame callback (in a frame with a new width, that callback
 * reads the rows wrapped anew before the timeline has seen them).
 */
const startProbe = (page: Page, eventId: string, edge: 'bottom' | 'top') =>
  page.evaluate(
    ({ id, readEdge }) => {
      const list = document.querySelector<HTMLElement>('[data-testid="room-virtual-inner"]');
      let area = list?.parentElement;
      while (area && !/auto|scroll/.test(getComputedStyle(area).overflowY)) {
        area = area.parentElement;
      }
      if (!list || !area) throw new Error('Timeline scroll area missing');
      const scrollArea = area;
      const places: number[] = [];
      const widths: [number, number] = [scrollArea.clientWidth, scrollArea.clientWidth];
      const loops: string[] = [];
      const onError = (event: ErrorEvent) => {
        if (/ResizeObserver loop/.test(event.message)) loops.push(event.message);
      };
      const read = () => {
        const message = document.querySelector(`[data-message-id="${id}"]`);
        if (!message) return Number.NaN;
        const view = scrollArea.getBoundingClientRect();
        const box = message.getBoundingClientRect();
        widths[0] = Math.min(widths[0], scrollArea.clientWidth);
        widths[1] = Math.max(widths[1], scrollArea.clientWidth);
        return readEdge === 'bottom' ? view.bottom - box.bottom : box.top - view.top;
      };
      const observer = new ResizeObserver(() => {
        places[Math.max(0, places.length - 1)] = read();
      });
      observer.observe(scrollArea);
      observer.observe(list);
      let frame = requestAnimationFrame(function tick() {
        places.push(read());
        frame = requestAnimationFrame(tick);
      });
      window.addEventListener('error', onError);
      (window as ProbeWindow).splitterDragProbe = {
        stop: () => {
          observer.disconnect();
          cancelAnimationFrame(frame);
          window.removeEventListener('error', onError);
          return { places, widths, loops };
        },
      };
    },
    { id: eventId, readEdge: edge }
  );

/** Drags the members splitter toward the room and back, then returns what the probe read. */
const dragSplitter = async (page: Page, eventId: string, edge: 'bottom' | 'top'): Promise<Drag> => {
  const splitter = page.locator('[data-testid="resizable-members-panel"] > [role="separator"]');
  const box = await splitter.boundingBox();
  if (!box) throw new Error('Members splitter missing');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await startProbe(page, eventId, edge);
  for (let step = 1; step <= STEPS; step += 1) {
    const travelled = (TRAVEL * (1 - Math.cos((2 * Math.PI * step) / STEPS))) / 2;
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(x - travelled, y);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const probe = (window as ProbeWindow).splitterDragProbe;
    if (!probe) throw new Error('Probe missing');
    return probe.stop();
  });
};

const openRoom = async (page: Page, name: string) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { reader, roomId, newest } = await seedRoom(name);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    roomId
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.locator(`[data-message-id="${newest}"]`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('resizable-members-panel')).toBeVisible();
  await page.waitForTimeout(2_000);
  return { errors, newest };
};

/**
 * The frames that show the message away from where the frames before and after show it, to the
 * same side: a place it took for one frame only.
 */
const framesOutOfPlace = (places: number[]): number[] =>
  places.flatMap((place, frame) => {
    const before = place - (places[frame - 1] ?? place);
    const after = place - (places[frame + 1] ?? place);
    return Math.abs(before) > TOLERANCE && Math.abs(after) > TOLERANCE && before * after > 0
      ? [frame]
      : [];
  });

const expectDragKeptPlace = (drag: Drag, errors: string[], what: string, still: boolean) => {
  // The room narrowed enough to wrap its messages anew.
  expect(drag.widths[1] - drag.widths[0], 'how far the room narrowed').toBeGreaterThan(150);
  expect(drag.places.length, 'frames read').toBeGreaterThan(STEPS / 2);
  const start = drag.places[0] ?? Number.NaN;
  const moved = drag.places.map((place) => Math.round((place - start) * 10) / 10);
  const places = `${what}: px from its place, per frame: ${moved.join(' ')}`;
  if (still) {
    expect(Math.max(...moved.map(Math.abs)), places).toBeLessThanOrEqual(TOLERANCE);
  } else {
    expect(framesOutOfPlace(drag.places), `frames out of place; ${places}`).toEqual([]);
    expect(Math.abs(moved[moved.length - 1] ?? Number.NaN), places).toBeLessThanOrEqual(TOLERANCE);
  }
  expect([
    ...drag.loops,
    ...errors.filter((message) => /ResizeObserver loop/.test(message)),
  ]).toEqual([]);
};

/** At the newest message: it stays above the composer in every frame. */
const dragAtNewest = async (page: Page, name: string) => {
  const { errors, newest } = await openRoom(page, name);
  const drag = await dragSplitter(page, newest, 'bottom');
  expectDragKeptPlace(drag, errors, 'the newest message', true);
};

/**
 * Up in the history: the message across the top of the view moves only when a row in view above
 * it wraps, stays where that puts it, and is back in its place once the room has its width back.
 */
const dragInHistory = async (page: Page, name: string) => {
  const { errors, newest } = await openRoom(page, name);
  const newestRow = page.locator(`[data-message-id="${newest}"]`);
  const place = await newestRow.boundingBox();
  if (!place) throw new Error('Newest message missing');
  // The reader's own wheel, over the messages.
  await page.mouse.move(place.x + 40, place.y - 200);
  await page.mouse.wheel(0, -1_400);
  await expect(page.getByRole('button', { name: 'Jump to Latest' })).toBeVisible();
  await page.waitForTimeout(1_500);
  const anchor = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[data-testid="room-virtual-inner"]');
    let area = list?.parentElement;
    while (area && !/auto|scroll/.test(getComputedStyle(area).overflowY)) area = area.parentElement;
    if (!area) throw new Error('Timeline scroll area missing');
    // Below the bars over the top of the rows, which the scroll padding keeps clear.
    const line =
      area.getBoundingClientRect().top + (parseFloat(getComputedStyle(area).scrollPaddingTop) || 0);
    const across = Array.from(document.querySelectorAll('[data-room-row-index]')).find((row) => {
      const { top, bottom } = row.getBoundingClientRect();
      return top <= line && bottom > line + 1;
    });
    return across?.querySelector('[data-message-id]')?.getAttribute('data-message-id') ?? null;
  });
  if (!anchor) throw new Error('No message across the top of the view');
  const drag = await dragSplitter(page, anchor, 'top');
  expectDragKeptPlace(drag, errors, 'the message at the top of the view', false);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const CASES = [
  ['a reader at the newest message keeps it above the composer', dragAtNewest, 'n'],
  ['a reader up in the history keeps their place', dragInHistory, 'h'],
] as const;

for (const [title, drag, name] of CASES) {
  test(`dragging the members splitter: ${title} (Chromium)`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(DESKTOP);
    await drag(page, `c${name}`);
  });

  test(`dragging the members splitter: ${title} (WebKit)`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(180_000);
    let browser: Browser | undefined;
    try {
      browser = await launchWebKit();
      const context = await browser.newContext({ viewport: DESKTOP, baseURL });
      await drag(await context.newPage(), `w${name}`);
    } finally {
      await browser?.close();
    }
  });
}
