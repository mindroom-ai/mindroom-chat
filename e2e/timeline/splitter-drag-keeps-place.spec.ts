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
// the message gained or lost and back. A reader up in the history, with a one-line message's row
// at the top of their view, keeps it there in every frame while the rows above it wrap out of
// sight. The drag raises no
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
  /** The messages of one line, whose rows keep their height at any width. */
  const oneLine: string[] = [];
  for (let index = 1; index <= MESSAGES; index += 1) {
    const who = index % 3 === 0 ? reader : writer;
    const lines = index === MESSAGES ? 5 : index % 6;
    const body = `Crossing ${index}: ${lines === 0 ? 'on time.' : NOTE.repeat(lines)}`;
    // eslint-disable-next-line no-await-in-loop
    newest = await sendRoomMessage(HOMESERVER, who.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    if (lines === 0) oneLine.push(newest);
  }
  return { reader, roomId, newest, oneLine };
};

type Drag = {
  /** The message's distance from its edge of the scroll area in each frame, as painted, in px. */
  places: number[];
  /** The scroll area's narrowest and widest width during the drag, in px. */
  widths: [number, number];
  loops: string[];
};
type ProbeWindow = Window & {
  /** Runs after each callback of a ResizeObserver, and after the microtasks that callback queued. */
  afterResizeObserver?: () => void;
  splitterDragProbe?: { stop: () => Drag };
};

/**
 * Lets the probe read after every ResizeObserver of the page, the timeline's row observer too.
 * The browser calls them after layout, last before it paints, and the timeline renders before the
 * paint in a microtask of its callbacks: what is read after the last of them is what the frame
 * paints. Runs before the app's scripts, which create their observers from this class.
 */
const installProbe = (page: Page) =>
  page.addInitScript(() => {
    const read = () => (window as ProbeWindow).afterResizeObserver?.();
    const Native = window.ResizeObserver;
    window.ResizeObserver = class extends Native {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          try {
            callback(entries, observer);
          } finally {
            read();
            queueMicrotask(() => {
              read();
              queueMicrotask(read);
            });
          }
        });
      }
    };
  });

/**
 * Starts reading where a message sits in each frame: its bottom edge above the scroll area's
 * (`bottom`), or its row's top edge below the scroll area's (`top`). A frame's place is its last
 * reading: the one after the last ResizeObserver callback of the frame (`installProbe`), or, in a
 * frame that resizes nothing, the one of its animation frame callback (in a frame with a new
 * width, that callback reads the rows wrapped anew before the timeline has seen them). An
 * observer of the scroll area, the list and the message's row reads in every pass that resizes
 * one of them.
 */
const startProbe = (page: Page, eventId: string, edge: 'bottom' | 'top') =>
  page.evaluate(
    ({ id, readEdge }) => {
      const list = document.querySelector<HTMLElement>('[data-testid="room-virtual-inner"]');
      let area = list?.parentElement;
      while (area && !/auto|scroll/.test(getComputedStyle(area).overflowY)) {
        area = area.parentElement;
      }
      const row = document.querySelector(`[data-message-id="${id}"]`)?.closest('[data-index]');
      if (!list || !area || !row) throw new Error('Timeline scroll area or row missing');
      const scrollArea = area;
      const places: number[] = [];
      const widths: [number, number] = [scrollArea.clientWidth, scrollArea.clientWidth];
      const loops: string[] = [];
      const onError = (event: ErrorEvent) => {
        if (/ResizeObserver loop/.test(event.message)) loops.push(event.message);
      };
      const read = () => {
        const message = document.querySelector(`[data-message-id="${id}"]`);
        const box = (
          readEdge === 'top' ? message?.closest('[data-index]') : message
        )?.getBoundingClientRect();
        if (!box) return Number.NaN;
        const view = scrollArea.getBoundingClientRect();
        widths[0] = Math.min(widths[0], scrollArea.clientWidth);
        widths[1] = Math.max(widths[1], scrollArea.clientWidth);
        return readEdge === 'bottom' ? view.bottom - box.bottom : box.top - view.top;
      };
      const probe = window as ProbeWindow;
      probe.afterResizeObserver = () => {
        places[Math.max(0, places.length - 1)] = read();
      };
      const observer = new ResizeObserver(() => {});
      [scrollArea, list, row].forEach((element) => observer.observe(element));
      let frame = requestAnimationFrame(function tick() {
        places.push(read());
        frame = requestAnimationFrame(tick);
      });
      window.addEventListener('error', onError);
      probe.splitterDragProbe = {
        stop: () => {
          probe.afterResizeObserver = undefined;
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
  const { reader, roomId, newest, oneLine } = await seedRoom(name);
  await installProbe(page);
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
  return { errors, newest, oneLine };
};

/** The message was in its place, within `TOLERANCE`, in every frame the browser painted. */
const expectDragKeptPlace = (drag: Drag, errors: string[], what: string) => {
  // The room narrowed enough to wrap its messages anew.
  expect(drag.widths[1] - drag.widths[0], 'how far the room narrowed').toBeGreaterThan(150);
  expect(drag.places.length, 'frames read').toBeGreaterThan(STEPS / 2);
  const start = drag.places[0] ?? Number.NaN;
  const moved = drag.places.map((place) => Math.round((place - start) * 10) / 10);
  const places = `${what}: px from its place, per frame: ${moved.join(' ')}`;
  // A frame without the message reads NaN, which is no place either.
  expect(
    moved.filter((px) => !(Math.abs(px) <= TOLERANCE)),
    places
  ).toEqual([]);
  expect([
    ...drag.loops,
    ...errors.filter((message) => /ResizeObserver loop/.test(message)),
  ]).toEqual([]);
};

/** At the newest message: it stays above the composer in every frame. */
const dragAtNewest = async (page: Page, name: string) => {
  const { errors, newest } = await openRoom(page, name);
  const drag = await dragSplitter(page, newest, 'bottom');
  expectDragKeptPlace(drag, errors, 'the newest message');
};

/**
 * The row of each message with its top edge at or below the reader's line, in px below it. The
 * timeline takes a row that ends above that line as out of sight: the line is as far below the
 * scroll area's top edge as the room's first row starts in the scroll content (the room header's
 * inset and the content before the rows lie above it).
 */
const rowsBelowLine = (page: Page, ids: string[]) =>
  page.evaluate((messages) => {
    const list = document.querySelector<HTMLElement>('[data-testid="room-virtual-inner"]');
    let area = list?.parentElement;
    while (area && !/auto|scroll/.test(getComputedStyle(area).overflowY)) area = area.parentElement;
    if (!list || !area) throw new Error('Timeline scroll area missing');
    const line = list.getBoundingClientRect().top + area.scrollTop;
    return messages.flatMap((id) => {
      const row = document.querySelector(`[data-message-id="${id}"]`)?.closest('[data-index]');
      const below = row ? row.getBoundingClientRect().top - line : Number.NaN;
      return below >= -2 ? [{ id, below }] : [];
    });
  }, ids);

/**
 * Up in the history, with the row of a one-line message at the top of the view: every row above
 * it is out of sight, so the rows that wrap anew move nothing the reader sees, and that row, which
 * keeps its height, stays where it is in every frame.
 */
const dragInHistory = async (page: Page, name: string) => {
  const { errors, newest, oneLine } = await openRoom(page, name);
  const newestRow = page.locator(`[data-message-id="${newest}"]`);
  const place = await newestRow.boundingBox();
  if (!place) throw new Error('Newest message missing');
  // The reader's own wheel, over the messages.
  await page.mouse.move(place.x + 40, place.y - 200);
  await page.mouse.wheel(0, -1_400);
  await expect(page.getByRole('button', { name: 'Jump to Latest' })).toBeVisible();
  await page.waitForTimeout(1_000);
  const [anchor] = (await rowsBelowLine(page, oneLine)).sort((a, b) => a.below - b.below);
  if (!anchor) throw new Error('No one-line message below the top of the view');
  // The wheel brings the row's top edge to the line, at most 1.5 px above it: the row before it
  // must end out of sight, or it would wrap in view and move the rows after it.
  await expect(async () => {
    const [row] = await rowsBelowLine(page, [anchor.id]);
    expect(row, 'the row left the view').toBeDefined();
    const below = row?.below ?? 0;
    if (below > -0.25) await page.mouse.wheel(0, Math.ceil(below + 0.25));
    expect(below).toBeLessThanOrEqual(-0.25);
    expect(below).toBeGreaterThan(-1.5);
  }).toPass({ timeout: 15_000, intervals: [500] });
  await page.waitForTimeout(1_500);
  const drag = await dragSplitter(page, anchor.id, 'top');
  expectDragKeptPlace(drag, errors, 'the row at the top of the view');
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
