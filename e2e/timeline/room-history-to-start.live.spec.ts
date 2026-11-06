import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
} from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

/**
 * Scrolling up through a long room in the Classic view reaches the room's start: every message of
 * the room's timeline (notes and thread roots) shows on the way, in the server's order, with no
 * space between rows and no blank space above them. Checked when the room opens and again after a
 * reload, at desktop size with classic scrollbars and on a touch phone, in Chromium and, when the
 * runner names it, in WebKit. Set ROOM_HISTORY_SHOTS=<directory> to save each view at the start.
 *
 * When a room opens, the client saves its newest 200 events for offline reading, and the next 200
 * on each later visit. This room's newest events end in an agent's streamed thread whose final
 * edits land after the agent's next reply, so each saved page starts with an edit whose reply is
 * older than the page. The cache keeps such an edit with the room's own events, and the room's
 * timeline does not take it. Scrolling up stopped there for good: the pager took the edit for a
 * page of older history, found nothing to show, and asked the cache for the same edit again,
 * never the server.
 */

const PASSWORD = 'room-history-to-start-1';
const SHOTS = process.env.ROOM_HISTORY_SHOTS;
const homeserver = getHomeserver();
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
type Device = 'desktop' | 'phone';
/** Rows touch; this absorbs subpixel rounding only. */
const MAX_ROW_GAP_PX = 2;
/** Above the oldest loaded row, the reader may see the "[+all]" line and the loading sentinel. */
const MAX_BLANK_ABOVE_ROWS_PX = 80;

// Deterministic text of realistic lengths: a person's notes and an agent's formatted answers.
const WORDS = (
  'the a deploy build branch cache config review merge check schedule server thread room ' +
  'message agent tool result error retry network latency timeout model token summary draft ' +
  'release notes migration backup database index query report chart metric alert queue worker'
).split(' ');
let seed = 7;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (list: string[]) => list[Math.floor(random() * list.length)] ?? 'note';
const sentence = (min: number, max: number) => {
  const words = Array.from({ length: min + Math.floor(random() * (max - min)) }, () => pick(WORDS));
  return `${words.join(' ').replace(/^./, (first) => first.toUpperCase())}.`;
};
const paragraph = (count: number) => Array.from({ length: count }, () => sentence(6, 18)).join(' ');
const note = () => ({ msgtype: 'm.text', body: paragraph(1 + Math.floor(random() * 3)) });
const answer = () => {
  const items = Array.from({ length: 2 + Math.floor(random() * 4) }, () => sentence(4, 12));
  const text = paragraph(1 + Math.floor(random() * 3));
  return {
    msgtype: 'm.text',
    body: `${text}\n\n${items.map((item) => `- ${item}`).join('\n')}`,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>${text}</p><ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`,
  };
};
const inThread = (rootId: string, previousId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: previousId },
  },
});
const editOf = (eventId: string) => {
  const content = answer();
  return {
    ...content,
    body: `* ${content.body}`,
    'm.new_content': content,
    'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
  };
};

const send = async (token: string, roomId: string, content: Record<string, unknown>) =>
  (
    await matrixFetch<{ event_id: string }>(
      homeserver,
      `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${randomUUID()}`,
      { method: 'PUT', accessToken: token, body: JSON.stringify(content) }
    )
  ).event_id;

/** Runs the tasks with at most `limit` at once. */
const pool = async (tasks: (() => Promise<unknown>)[], limit: number) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < tasks.length) {
        const task = tasks[next];
        next += 1;
        // eslint-disable-next-line no-await-in-loop
        await task?.();
      }
    })
  );
};

type RawEvent = {
  event_id: string;
  type: string;
  origin_server_ts: number;
  content?: { 'm.relates_to'?: { rel_type?: string } };
};
type SentMessage = { id: string; ts: number };

/** The room's own messages (no thread replies, no edits), oldest first, as the server orders them. */
const listRoomMessages = async (token: string, roomId: string): Promise<SentMessage[]> => {
  const messages: SentMessage[] = [];
  let from = '';
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const page = await matrixFetch<{ chunk: RawEvent[]; end?: string }>(
      homeserver,
      `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=500${
        from ? `&from=${encodeURIComponent(from)}` : ''
      }`,
      { accessToken: token }
    );
    page.chunk.forEach((event) => {
      const relation = event.content?.['m.relates_to']?.rel_type;
      if (event.type === 'm.room.message' && relation !== 'm.thread' && relation !== 'm.replace')
        messages.push({ id: event.event_id, ts: event.origin_server_ts });
    });
    if (!page.end || page.chunk.length === 0) break;
    from = page.end;
  }
  return messages.reverse();
};

type Fixture = {
  username: string;
  userId: string;
  roomId: string;
  /** The room's own messages, oldest first. */
  messages: string[];
  /** When each was sent: the order of two sent in the same millisecond is the server's alone. */
  sentAt: number[];
};

const seedAccount = async (): Promise<Fixture> => {
  const username = `history${randomUUID().slice(0, 8)}`;
  const person = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const agent = await registerAgentAccount(homeserver, 'history');
  const token = person.access_token;
  const roomId = await createPrivateRoom(homeserver, token, {
    name: 'Research notes',
    topic: 'Notes and the agent’s answers',
    invite: [agent.userId],
  });
  await joinRoom(homeserver, agent.accessToken, roomId);

  // Older history: notes and threads with the agent's edited answers, sent side by side.
  const thread = async (replies: number) => {
    const rootId = await send(token, roomId, note());
    let previous = rootId;
    for (let reply = 0; reply < replies; reply += 1) {
      // eslint-disable-next-line no-await-in-loop
      const replyId = await send(agent.accessToken, roomId, {
        ...answer(),
        ...inThread(rootId, previous),
      });
      // eslint-disable-next-line no-await-in-loop
      if (random() < 0.3) await send(agent.accessToken, roomId, editOf(replyId));
      previous = replyId;
    }
  };
  await pool(
    [
      ...Array.from({ length: 50 }, () => () => send(token, roomId, note())),
      ...Array.from({ length: 10 }, () => () => thread(4 + Math.floor(random() * 9))),
    ],
    4
  );

  // The agent streams 220 answers into one thread; each final edit lands after its next answer.
  const streamRootId = await send(token, roomId, note());
  let previous = streamRootId;
  let unfinished: string | undefined;
  for (let reply = 0; reply < 220; reply += 1) {
    // eslint-disable-next-line no-await-in-loop
    const replyId = await send(agent.accessToken, roomId, {
      ...answer(),
      ...inThread(streamRootId, previous),
    });
    // eslint-disable-next-line no-await-in-loop
    if (unfinished) await send(agent.accessToken, roomId, editOf(unfinished));
    unfinished = replyId;
    previous = replyId;
  }
  if (unfinished) await send(agent.accessToken, roomId, editOf(unfinished));

  // The newest messages: notes and two short threads.
  for (let index = 0; index < 30; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(token, roomId, note());
  }
  for (let index = 0; index < 2; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await thread(4);
  }

  // Other rooms, as an account has.
  await pool(
    Array.from({ length: 25 }, (_, index) => async () => {
      const otherId = await createPrivateRoom(homeserver, token, {
        name: `Project ${index + 1}`,
        topic: 'Another room of the account',
      });
      await send(token, otherId, note());
    }),
    8
  );
  const sent = await listRoomMessages(token, roomId);
  return {
    username,
    userId: person.user_id,
    roomId,
    messages: sent.map(({ id }) => id),
    sentAt: sent.map(({ ts }) => ts),
  };
};

/** One rest of the reader: how the rows in view sit. */
type Rest = {
  /** The largest vertical space between two rows in view. */
  maxGap: number;
  /** Space between the top of the visible band and the first row in view. */
  blankAbove: number;
  /** Whether the room's first message is in view. */
  atStart: boolean;
};

/** What the timeline rendered, frame by frame, while the reader scrolled. */
type Watch = { seen: string[]; outOfOrder: string[][] };
type WatchWindow = Window & { roomHistoryWatch?: Watch & { stop: () => void } };

/** The room timeline's scroll area: the nearest scrolling box around its virtual list. */
const findScroller = (page: Page) =>
  page.getByTestId('room-virtual-inner').evaluateHandle((inner) => {
    let node = inner.parentElement;
    while (node && !['auto', 'scroll'].includes(getComputedStyle(node).overflowY))
      node = node.parentElement;
    if (!node) throw new Error('The timeline has no scroll area');
    return node;
  });
type Scroller = Awaited<ReturnType<typeof findScroller>>;

/**
 * Records, on every frame, the room's messages the timeline renders (the rows in view and those
 * the virtual list keeps ready around them) and any frame whose visible band (between the room
 * header and the composer) shows two of them out of the server's order. A window that skipped
 * rows would never render them; a slow frame rate only skips frames. Two messages sent in the
 * same millisecond may show in either order: the cache orders them by event ID.
 */
const startWatch = (scroller: Scroller, fixture: Fixture) =>
  scroller.evaluate(
    (view, { ids, times }) => {
      const position = new Map(ids.map((id, index) => [id, index]));
      const sentAt = new Map(ids.map((id, index) => [id, times[index]]));
      const seen = new Set<string>();
      const outOfOrder: string[][] = [];
      let running = true;
      const tick = () => {
        if (!running) return;
        const style = getComputedStyle(view);
        const box = view.getBoundingClientRect();
        const bandTop = box.top + (Number.parseFloat(style.scrollPaddingTop) || 0);
        const bandBottom = box.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0);
        const rows = Array.from(view.querySelectorAll<HTMLElement>('[data-message-id]')).map(
          (row) => ({ id: row.dataset.messageId ?? '', rect: row.getBoundingClientRect() })
        );
        rows.forEach(({ id }) => seen.add(id));
        const shown = rows
          .filter(
            ({ id, rect }) => position.has(id) && rect.bottom > bandTop && rect.top < bandBottom
          )
          .sort((a, b) => a.rect.top - b.rect.top)
          .map(({ id }) => id);
        const swapped = shown.some((id, at) => {
          const above = shown[at - 1];
          return (
            above !== undefined &&
            (position.get(id) ?? -1) < (position.get(above) ?? -1) &&
            sentAt.get(id) !== sentAt.get(above)
          );
        });
        if (swapped) outOfOrder.push(shown);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      (window as WatchWindow).roomHistoryWatch = {
        get seen() {
          return [...seen];
        },
        outOfOrder,
        stop: () => {
          running = false;
        },
      };
    },
    { ids: fixture.messages, times: fixture.sentAt }
  );

const readWatch = (page: Page) =>
  page.evaluate((): Watch => {
    const watch = (window as WatchWindow).roomHistoryWatch;
    return { seen: watch?.seen ?? [], outOfOrder: watch?.outOfOrder ?? [] };
  });

const readRest = (scroller: Scroller, first: string) =>
  scroller.evaluate((view, firstId): Rest => {
    const style = getComputedStyle(view);
    const box = view.getBoundingClientRect();
    const bandTop = box.top + (Number.parseFloat(style.scrollPaddingTop) || 0);
    const bandBottom = box.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0);
    const inBand = (rect: DOMRect) =>
      rect.height > 0 && rect.bottom > bandTop && rect.top < bandBottom;
    const tiles = Array.from(
      view.querySelectorAll<HTMLElement>('[data-testid="room-virtual-inner"] > [data-index]')
    )
      .map((tile) => tile.getBoundingClientRect())
      .filter(inBand)
      .sort((a, b) => a.top - b.top);
    let maxGap = 0;
    for (let index = 1; index < tiles.length; index += 1) {
      const above = tiles[index - 1];
      const below = tiles[index];
      if (above && below) maxGap = Math.max(maxGap, below.top - above.bottom);
    }
    const firstRow = view.querySelector<HTMLElement>(`[data-message-id="${firstId}"]`);
    return {
      maxGap,
      blankAbove: tiles[0] ? tiles[0].top - bandTop : bandBottom - bandTop,
      atStart: !!firstRow && inBand(firstRow.getBoundingClientRect()),
    };
  }, first);

/**
 * One flick upward: eight wheel notches 40 ms apart on a desktop. A phone has no wheel (mobile
 * WebKit refuses one), so there a finger touches the timeline, moves it in eight steps of the
 * same size and lifts: the app sees the touch that hands the scroll position to the reader.
 */
const flick = async (page: Page, scroller: Scroller, device: Device) => {
  if (device === 'phone')
    await scroller.evaluate((view) =>
      view.dispatchEvent(new Event('touchstart', { bubbles: true }))
    );
  for (let notch = 0; notch < 8; notch += 1) {
    if (device === 'desktop') {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -320);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await scroller.evaluate((view) => view.scrollBy({ top: -320 }));
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(40);
  }
  if (device === 'phone')
    await scroller.evaluate((view) => view.dispatchEvent(new Event('touchend', { bubbles: true })));
};

/**
 * Reads upward like a person: a flick, then a glance, until the room's first message is in view or
 * nothing new shows for fifteen flicks.
 */
const scrollToStart = async (page: Page, fixture: Fixture, device: Device, label: string) => {
  const scroller = await findScroller(page);
  const box = await scroller.boundingBox();
  if (!box) throw new Error('The timeline is not laid out');
  if (device === 'desktop') await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const first = fixture.messages[0] ?? '';
  await startWatch(scroller, fixture);
  const rests: Rest[] = [];
  let seen = 0;
  let idle = 0;
  while (idle < 15) {
    // eslint-disable-next-line no-await-in-loop
    await flick(page, scroller, device);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(300);
    // eslint-disable-next-line no-await-in-loop
    const rest = await readRest(scroller, first);
    rests.push(rest);
    if (rest.atStart) break;
    // eslint-disable-next-line no-await-in-loop
    const now = (await readWatch(page)).seen.length;
    idle = now === seen ? idle + 1 : 0;
    seen = now;
  }
  const watch = await readWatch(page);
  await page.evaluate(() => (window as WatchWindow).roomHistoryWatch?.stop());
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}.png` });
  }

  const rendered = new Set(watch.seen);
  const missing = fixture.messages.flatMap((id, index) =>
    rendered.has(id) ? [] : [`${index + 1} of ${fixture.messages.length}: ${id}`]
  );
  expect(missing, `${label}: room messages never shown on the way to the start`).toEqual([]);
  expect(watch.outOfOrder, `${label}: room messages out of order`).toEqual([]);
  const gaps = rests.map((rest) => Math.round(rest.maxGap));
  expect(Math.max(...gaps), `${label}: space between rows at rest`).toBeLessThanOrEqual(
    MAX_ROW_GAP_PX
  );
  // Blank space above the rows is the room's start (its intro) or nothing.
  const blank = rests.filter((rest) => !rest.atStart).map((rest) => Math.round(rest.blankAbove));
  expect(Math.max(0, ...blank), `${label}: blank space above the rows`).toBeLessThanOrEqual(
    MAX_BLANK_ABOVE_ROWS_PX
  );
};

/**
 * Watches for the room's first offline page: the newest 200 events, asked from the live end (no
 * `from`), which the first visit saves while it shows the room. The room's own pages always name
 * where they start.
 */
const watchFirstOfflinePage = (page: Page, fixture: Fixture) => {
  let saved = false;
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      url.pathname.endsWith(`/rooms/${encodeURIComponent(fixture.roomId)}/messages`) &&
      url.searchParams.get('limit') === '200' &&
      !url.searchParams.has('from') &&
      response.ok()
    )
      saved = true;
  });
  return () => saved;
};

const openRoom = async (page: Page, fixture: Fixture) => {
  const offlinePageSaved = watchFirstOfflinePage(page, fixture);
  await loginWithPassword(page, { homeserver, username: fixture.username, password: PASSWORD });
  await seedRoomOverviewState({
    page,
    roomId: fixture.roomId,
    userId: fixture.userId,
    viewMode: 'classic',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
  await expect(
    page.locator(`[data-message-id="${fixture.messages[fixture.messages.length - 1]}"]`)
  ).toBeVisible({ timeout: 60_000 });
  // The reader scrolls once the visit has saved its page, as anyone does who reads for a moment.
  await expect.poll(offlinePageSaved, { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(1_000);
};

const readToStart = async (
  context: BrowserContext,
  fixture: Fixture,
  device: Device,
  label: string,
  reload: boolean
) => {
  const page = await context.newPage();
  await openRoom(page, fixture);
  if (reload) {
    // The reload opens the room from what the first visit saved; its own visit saves the next
    // page, which starts with an edit whose answer is older than the page too.
    await page.reload();
    await expect(
      page.locator(`[data-message-id="${fixture.messages[fixture.messages.length - 1]}"]`)
    ).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2_000);
  }
  await scrollToStart(page, fixture, device, label);
};

let fixture: Fixture;

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    // Classic scrollbars, as desktop readers without overlay scrollbars have them.
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

test.describe('scrolling up through a long room reaches its start', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    let reachable = false;
    try {
      reachable = (await fetch(`${homeserver}/_matrix/client/versions`)).ok;
    } catch {
      reachable = false;
    }
    test.skip(!reachable, `No homeserver at ${homeserver}`);
    fixture = await seedAccount();
  });

  const cases = [
    { engine: 'chromium', device: 'desktop' },
    { engine: 'chromium', device: 'phone' },
    { engine: 'webkit', device: 'desktop' },
    { engine: 'webkit', device: 'phone' },
  ] as const;
  cases.forEach(({ engine, device }) => {
    [false, true].forEach((reload) => {
      const label = `classic-${engine}-${device}${reload ? '-reload' : ''}`;
      test(`Classic view, ${engine}, ${device}${reload ? ', after a reload' : ''}`, async ({
        browser,
        baseURL,
      }) => {
        test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
        test.setTimeout(300_000);
        const options = { ...(device === 'phone' ? PHONE : DESKTOP), baseURL };
        const host = engine === 'webkit' ? await launchWebKit() : undefined;
        const context = await (host ?? browser).newContext(options);
        try {
          await readToStart(context, fixture, device, label, reload);
        } finally {
          await context.close();
          await host?.close();
        }
      });
    });
  });
});
