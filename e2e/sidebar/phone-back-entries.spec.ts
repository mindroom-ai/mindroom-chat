import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import { openRoomPins } from '../helpers/roomMenu';

// On a phone, a thread's back chevron always leads to the thread's room, and a room's returns to
// wherever the person opened it from: the room list, a notification, the command palette, the
// search results, a link in another conversation, Activity, the pinned messages or Jump to Time.
// A thread opened from its room steps back to it; opened from anywhere else, the room takes the
// thread's place, so the room's chevron then returns to where the thread was opened from. A
// room's chevron steps back past every page of the room, and the browser's back then goes on from
// there. Each way in is its own test, at 390 by 844 with touch, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'phone-back-entries-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const ENGINES = ['chromium', 'webkit'] as const;
type Engine = (typeof ENGINES)[number];

// A list long enough to scroll, as a real account's is.
const OTHER_ROOMS = [
  'Allotment Waiting List',
  'Bicycle Repair Evenings',
  'Choir Rehearsal Notes',
  'Community Fridge Rota',
  'Darkroom Bookings',
  'Dog Walking Swaps',
  'Film Night Votes',
  'Folk Dance Practice',
  'Hiking Routes',
  'Language Exchange',
  'Library Volunteers',
  'Makerspace Tools',
  'Market Stall Planning',
  'Neighborhood Watch',
  'Pottery Kiln Schedule',
  'Recipe Exchange',
  'Repair Cafe',
  'Rowing Club Crews',
  'School Run Carpool',
  'Street Party Committee',
  'Tool Library',
  'Youth Football Coaches',
];

type Seed = {
  username: string;
  writer: MatrixSession;
  /** A word only this run's garden messages contain, for the message search. */
  word: string;
  harbor: string;
  harborRoot: string;
  garden: string;
  gardenRoot: string;
  gardenReply: string;
  gardenNote: string;
  books: string;
  booksRoot: string;
  /** A thread of Book Swap that mentions the reader, for Activity; no other way in opens it. */
  shelfRoot: string;
};

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const register = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `pbe_${name}_${RUN}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { username, userId: body.user_id, accessToken: body.access_token };
};

const text = (body: string) => ({ msgtype: 'm.text', body });
const inThread = (rootId: string, content: Record<string, unknown>) => ({
  ...content,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});
const mention = (userId: string, words: string) => ({
  ...text(`${userId} ${words}`),
  'm.mentions': { user_ids: [userId] },
});
const permalink = (roomId: string, eventId: string) =>
  `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`;

const seed = async (engine: Engine): Promise<Seed> => {
  const reader = await register(`reader_${engine}`);
  const writer = await register(`writer_${engine}`);
  // Letters only, so the search tokenizer keeps it one word.
  const word = `heron${RUN.replace(/[0-9]/g, (digit) => 'abcdefghij'[Number(digit)]!)}${engine[0]}`;
  const create = (name: string, invite?: string[]) =>
    createPrivateRoom(HOMESERVER, reader.accessToken, { name, topic: `${name} notes`, invite });
  // The rooms the flows use have an agent, as MindRoom rooms do, so they open in Compact.
  const agent = await registerAgentAccount(HOMESERVER, `pbe${engine[0]}`);
  const say = (roomId: string, content: Record<string, unknown>, session: MatrixSession = reader) =>
    sendRoomMessage(HOMESERVER, session.accessToken, roomId, content, 'phone-back-entries');

  await Promise.all(OTHER_ROOMS.map((name) => create(name)));

  const garden = await create('Garden Club', [agent.userId]);
  const gardenNote = await say(
    garden,
    text(`The planting rota for ${word} is pinned by the shed door; swap a turn with anyone on it.`)
  );
  const gardenRoot = await say(
    garden,
    text('Seed order for spring: tomatoes, beans and two kinds of squash. Anything else by Friday?')
  );
  const gardenReply = await say(
    garden,
    inThread(
      gardenRoot,
      text(`The seed catalogue with the ${word} beans arrives Tuesday, so the order can wait.`)
    )
  );
  await say(
    garden,
    inThread(gardenRoot, text('Add marigolds for the border, please; the old packets failed.'))
  );
  await sendStateEvent(HOMESERVER, reader.accessToken, garden, 'm.room.pinned_events', '', {
    pinned: [gardenNote, gardenReply],
  });

  const harbor = await create('Harbor Plans', [agent.userId]);
  const harborRoot = await say(
    harbor,
    text('Crane schedule for the north pier next week: who still needs a slot?')
  );
  await say(harbor, inThread(harborRoot, text('Morning slots on Monday and Wednesday are open.')));
  await say(
    harbor,
    inThread(
      harborRoot,
      text(
        `The garden club asked about the same week: ${permalink(garden, gardenReply)} ` +
          `and their rota is here: ${permalink(garden, gardenNote)}`
      )
    )
  );

  const books = await create('Book Swap', [writer.userId, agent.userId]);
  await joinRoom(HOMESERVER, writer.accessToken, books);
  const booksRoot = await say(
    books,
    text('Which titles are coming to the swap on Saturday morning?'),
    writer
  );
  // Activity lists this thread, which names the reader.
  const shelfRoot = await say(books, text('Who can help sort the shelves on Saturday?'), writer);
  await say(
    books,
    inThread(shelfRoot, mention(reader.userId, 'the poetry shelf needs a volunteer too')),
    writer
  );
  return {
    username: reader.username,
    writer,
    word,
    harbor,
    harborRoot,
    garden,
    gardenRoot,
    gardenReply,
    gardenNote,
    books,
    booksRoot,
    shelfRoot,
  };
};

const seeds = new Map<Engine, Promise<Seed>>();
const seeded = (engine: Engine): Promise<Seed> => {
  if (!seeds.has(engine)) seeds.set(engine, seed(engine));
  return seeds.get(engine)!;
};

/**
 * The browser's Notification API as a recorder: permission granted, every notification kept on
 * `window.shownNotifications`, and `window.clickNotification(i)` clicks one.
 */
const recordNotifications = () => {
  type Recorded = { title: string; onclick: (() => void) | null };
  const shown: Recorded[] = [];
  const recorder = window as unknown as {
    shownNotifications: Recorded[];
    clickNotification: (index: number) => void;
  };
  recorder.shownNotifications = shown;
  recorder.clickNotification = (index) => shown[index]?.onclick?.();
  class RecordingNotification {
    static permission = 'granted';
    static requestPermission = async () => 'granted';
    constructor(title: string) {
      const entry: Recorded = { title, onclick: null };
      shown.push(entry);
      Object.defineProperty(this, 'onclick', {
        get: () => entry.onclick,
        set: (handler: (() => void) | null) => {
          entry.onclick = handler;
        },
      });
    }
    close() {
      return undefined;
    }
  }
  Object.defineProperty(window, 'Notification', { value: RecordingNotification });
};

type Place = { path: string; room: string | null; thread: string | null };

/** The page's place: its path, the room it shows, and the thread open in it. */
const place = (page: Page): Place => {
  const url = new URL(page.url());
  const room = url.pathname
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .find((segment) => segment.startsWith('!'));
  return { path: url.pathname, room: room ?? null, thread: url.searchParams.get('threadId') };
};

const HOME: Partial<Place> = { path: '/home/', room: null, thread: null };
const inRoom = (room: string): Partial<Place> => ({ room, thread: null });
const inThreadOf = (room: string, thread: string): Partial<Place> => ({ room, thread });

const expectAt = (page: Page, expected: Partial<Place>, step: string) =>
  expect.poll(() => place(page), { message: step, timeout: 20_000 }).toMatchObject(expected);

/** The browser's back (Android's back button, Safari's edge swipe) never reopens `room`. */
const browserBackLeaves = async (page: Page, room: string, step: string) => {
  await page.goBack();
  await expect.poll(() => place(page).room, { message: step, timeout: 20_000 }).not.toBe(room);
};

const roomBack = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: 'Back', exact: true });
const threadBack = (page: Page) =>
  page.locator('[data-thread-context-banner]').getByRole('button', { name: 'Back', exact: true });

const shoot = (page: Page, testInfo: TestInfo, name: string) =>
  page.screenshot({ path: testInfo.outputPath(`${name}.png`) });

const openFromList = async (page: Page, name: string, room: string) => {
  await page.getByTestId('resizable-page-nav').getByRole('link', { name }).tap();
  await expectAt(page, inRoom(room), `${name} opens from the list`);
};

const openThread = async (page: Page, room: string, rootId: string) => {
  await page.locator(`button[data-thread-root-id="${rootId}"]`).first().tap();
  await expectAt(page, inThreadOf(room, rootId), 'the thread opens from its room');
  await expect(threadBack(page)).toBeVisible();
};

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette', exact: true });

/** The top bar's search field: the palette, on its Messages tab, with `word` typed. */
const searchMessages = async (page: Page, word: string) => {
  await page.getByRole('button', { name: 'Find anything', exact: true }).tap();
  await palette(page).getByRole('tab', { name: 'Messages', exact: true }).tap();
  await palette(page).getByRole('combobox').fill(word);
};

/**
 * A swipe from the screen's start edge toward the middle. Chromium gets real touches (12 moves of
 * 16 ms, as a finger makes them), so the browser could take the rest of the swipe as its own back
 * gesture; Playwright drives WebKit's touches only through its taps, so WebKit gets the events the
 * app's gesture listens to.
 */
const edgeSwipeBack = async (page: Page, engine: Engine) => {
  const xs = Array.from({ length: 12 }, (_, step) => 4 + (step + 1) * 24);
  if (engine === 'chromium') {
    const touch = await page.context().newCDPSession(page);
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) =>
      touch.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x === undefined ? [] : [{ x, y: 420, id: 1 }],
      });
    await send('touchStart', 4);
    for (const x of xs) {
      await send('touchMove', x);
      await page.waitForTimeout(16);
    }
    await send('touchEnd');
    await touch.detach();
    return;
  }
  await page.evaluate((moves) => {
    const fire = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const touches = type === 'touchend' ? [] : [{ identifier: 1, clientX: x, clientY: 420 }];
      Object.defineProperty(event, 'touches', { value: touches });
      window.dispatchEvent(event);
    };
    fire('touchstart', 4);
    for (const x of moves) fire('touchmove', x);
    fire('touchend', moves[moves.length - 1]!);
  }, xs);
};

type Flow = (page: Page, seed: Seed, testInfo: TestInfo, engine: Engine) => Promise<void>;

const FLOWS: Record<string, Flow> = {
  'the room list': async (page, { harbor, garden, gardenRoot }, testInfo, engine) => {
    await openFromList(page, 'Garden Club', garden);
    await openThread(page, garden, gardenRoot);
    await threadBack(page).tap();
    await expectAt(page, inRoom(garden), 'the thread chevron returns to the room');
    await roomBack(page).tap();
    await expectAt(page, HOME, 'the room chevron returns to the list');

    // The edge swipe leaves a thread for its room, one step, also after another room: the
    // browser must not take the rest of the swipe as its own back.
    await openFromList(page, 'Harbor Plans', harbor);
    await pressPaletteShortcut(page);
    await palette(page).getByRole('combobox').fill('Garden Club');
    await palette(page)
      .locator('[role="option"][data-kind="room"]')
      .filter({ hasText: 'Garden Club' })
      .tap();
    await expectAt(page, inRoom(garden), 'the palette opens the second room');
    await openThread(page, garden, gardenRoot);
    await edgeSwipeBack(page, engine);
    await shoot(page, testInfo, 'list-edge-swipe');
    await expectAt(page, inRoom(garden), 'the edge swipe returns to the room');
    // Settled: nothing goes back a second step.
    await page.waitForTimeout(1_000);
    await expectAt(page, inRoom(garden), 'the edge swipe went back one step only');
    await roomBack(page).tap();
    await expectAt(page, inRoom(harbor), 'the room chevron returns to the first room');
    await roomBack(page).tap();
    await expectAt(page, HOME, 'then to the list');
    await browserBackLeaves(page, garden, 'browser back after the chevrons leaves the list');
  },

  'a notification': async (page, { harbor, books, booksRoot, writer }, testInfo) => {
    await openFromList(page, 'Harbor Plans', harbor);
    type Recorder = { shownNotifications: unknown[]; clickNotification: (index: number) => void };
    const count = () =>
      page.evaluate(() => (window as unknown as Recorder).shownNotifications.length);
    const clickNewest = () =>
      page.evaluate(() => {
        const recorder = window as unknown as Recorder;
        recorder.clickNotification(recorder.shownNotifications.length - 1);
      });

    // A thread reply notifies; its thread opens over the room the person is in.
    const before = await count();
    await sendRoomMessage(
      HOMESERVER,
      writer.accessToken,
      books,
      inThread(booksRoot, text('Bringing two mystery novels and a cookbook along.'))
    );
    await expect.poll(count, { timeout: 30_000 }).toBeGreaterThan(before);
    await clickNewest();
    await expectAt(page, inThreadOf(books, booksRoot), 'the notification opens its thread');
    await threadBack(page).tap();
    await expectAt(page, inRoom(books), "the thread chevron leads to the thread's room");
    await roomBack(page).tap();
    await expectAt(page, inRoom(harbor), 'the room chevron returns to the room it opened over');

    // A message in the room's own timeline opens the room.
    const next = await count();
    await sendRoomMessage(
      HOMESERVER,
      writer.accessToken,
      books,
      text('The swap starts at ten; the tables are by the window.')
    );
    await expect.poll(count, { timeout: 30_000 }).toBeGreaterThan(next);
    await clickNewest();
    await expectAt(page, inRoom(books), 'the notification opens its room');
    await roomBack(page).tap();
    await shoot(page, testInfo, 'notification-room-back');
    await expectAt(page, inRoom(harbor), 'the room chevron returns to the room it opened over');
    await roomBack(page).tap();
    await expectAt(page, HOME, 'then to the list');
    await browserBackLeaves(page, harbor, 'browser back after the chevrons leaves the list');
  },

  'the command palette': async (page, { harbor, books, garden, gardenRoot, word }, testInfo) => {
    // A room picked in the palette over another room.
    await openFromList(page, 'Harbor Plans', harbor);
    await pressPaletteShortcut(page);
    await palette(page).getByRole('combobox').fill('Book Swap');
    await palette(page)
      .locator('[role="option"][data-kind="room"]')
      .filter({ hasText: 'Book Swap' })
      .tap();
    await expectAt(page, inRoom(books), 'the palette opens the room');
    await roomBack(page).tap();
    await shoot(page, testInfo, 'palette-room-back');
    await expectAt(page, inRoom(harbor), 'the room chevron returns to the room under the palette');
    await roomBack(page).tap();
    await expectAt(page, HOME, 'then to the list');

    // A message found in the palette's Messages tab, in a thread. Its snippet starts a few
    // words before the match, so the row is picked by the words around the match.
    await searchMessages(page, word);
    await palette(page)
      .locator('[role="option"][data-kind="message"]')
      .filter({ hasText: `${word} beans` })
      .tap();
    await expectAt(page, inThreadOf(garden, gardenRoot), 'the found reply opens its thread');
    await threadBack(page).tap();
    await shoot(page, testInfo, 'palette-thread-back');
    await expectAt(page, inRoom(garden), "the thread chevron leads to the thread's room");
    await roomBack(page).tap();
    await expectAt(page, HOME, 'the room chevron returns to the page under the palette');
    await browserBackLeaves(page, garden, 'browser back after the chevrons leaves the list');
  },

  'the search results': async (
    page,
    { garden, gardenRoot, gardenReply, gardenNote, word },
    testInfo,
    engine
  ) => {
    await searchMessages(page, word);
    await palette(page).locator('[role="option"][data-kind="search-page"]').tap();
    const results: Partial<Place> = { path: '/home/search/', room: null, thread: null };
    await expectAt(page, results, 'See all results opens the search page');
    const searchbox = page.getByRole('searchbox', { name: 'Search Messages' });
    const openReply = page.locator(
      `[data-event-id="${gardenReply}"][data-thread-root-id="${gardenRoot}"]`
    );

    // A thread reply opens in its thread; its chevron leads to the thread's room, and the room's
    // to the results.
    await openReply.tap();
    await expectAt(page, inThreadOf(garden, gardenRoot), 'the reply opens its thread');
    await threadBack(page).tap();
    await shoot(page, testInfo, 'search-thread-back');
    await expectAt(page, inRoom(garden), "the thread chevron leads to the thread's room");
    await roomBack(page).tap();
    await expectAt(page, results, 'the room chevron returns to the results');
    await expect(searchbox).toHaveValue(word);

    // The edge swipe does the same.
    await openReply.tap();
    await expectAt(page, inThreadOf(garden, gardenRoot), 'the reply opens its thread again');
    await edgeSwipeBack(page, engine);
    await expectAt(page, inRoom(garden), "the edge swipe leads to the thread's room");
    await roomBack(page).tap();
    await expectAt(page, results, 'the room chevron returns to the results again');

    // A message of the room's own timeline opens the room; its chevron returns to the results.
    await page.locator(`[data-event-id="${gardenNote}"]`).tap();
    await expectAt(page, inRoom(garden), 'the message opens its room');
    await roomBack(page).tap();
    await shoot(page, testInfo, 'search-room-back');
    await expectAt(page, results, 'the room chevron returns to the results');
    await expect(searchbox).toHaveValue(word);
    await page.getByRole('button', { name: 'Back', exact: true }).tap();
    await expectAt(page, HOME, 'the results go back to the list');
    await browserBackLeaves(page, garden, 'browser back after the chevrons leaves the list');
  },

  'a permalink': async (page, seed, testInfo) => {
    const { harbor, harborRoot, garden, gardenRoot, gardenReply, gardenNote } = seed;
    await openFromList(page, 'Harbor Plans', harbor);
    await openThread(page, harbor, harborRoot);

    // A link to a thread reply in another room opens that thread; its chevron leads to that
    // thread's room, and the room's back to the first thread.
    await page.locator(`a[data-mention-event-id="${gardenReply}"]`).tap();
    await expectAt(page, inThreadOf(garden, gardenRoot), 'the link opens the linked thread');
    await threadBack(page).tap();
    await shoot(page, testInfo, 'permalink-thread-back');
    await expectAt(page, inRoom(garden), "the chevron leads to the linked thread's room");
    await roomBack(page).tap();
    await expectAt(page, inThreadOf(harbor, harborRoot), 'the room chevron returns to the thread');

    // A link to a message of the other room's own timeline opens that room.
    await page.locator(`a[data-mention-event-id="${gardenNote}"]`).tap();
    await expectAt(page, inRoom(garden), 'the link opens the linked room');
    await roomBack(page).tap();
    await shoot(page, testInfo, 'permalink-room-back');
    await expectAt(page, inThreadOf(harbor, harborRoot), 'the room chevron returns to the thread');

    await threadBack(page).tap();
    await expectAt(page, inRoom(harbor), 'the thread chevron returns to its room');
    await roomBack(page).tap();
    await expectAt(page, HOME, 'the room chevron returns to the list');
    await browserBackLeaves(page, harbor, 'browser back after the chevrons leaves the list');
  },

  Activity: async (page, { books, shelfRoot }, testInfo) => {
    // The bell of the rail in the drawer opens the Activity list.
    await page
      .getByRole('navigation', { name: 'Main', exact: true })
      .getByRole('button', { name: /^Activity/ })
      .tap();
    const activity: Partial<Place> = { path: '/activity/', room: null, thread: null };
    await expectAt(page, activity, 'the bell opens Activity');
    const row = page
      .getByRole('navigation', { name: 'Activity', exact: true })
      .locator('[data-activity-row]')
      .filter({ hasText: 'poetry shelf' });

    await row.getByRole('button').first().tap();
    await expectAt(page, inThreadOf(books, shelfRoot), 'the row leads to the thread');
    await threadBack(page).tap();
    await shoot(page, testInfo, 'activity-thread-back');
    await expectAt(page, inRoom(books), "the thread chevron leads to the thread's room");
    await roomBack(page).tap();
    await expectAt(page, activity, 'the room chevron returns to Activity');
    await expect(row).toBeVisible();
  },

  'the pinned messages': async (
    page,
    { garden, gardenRoot, gardenReply, gardenNote },
    testInfo
  ) => {
    await openFromList(page, 'Garden Club', garden);
    const openPin = async (eventId: string, words: string) => {
      // A phone's room menu holds Pinned Messages.
      await openRoomPins(page);
      const menu = page.getByRole('dialog', { name: 'Pinned Messages', exact: true });
      await menu.locator(`[data-pinned-event-id="${eventId}"]`).getByText(words).tap();
      await expect(menu).toHaveCount(0);
    };

    // A pinned thread reply opens its thread; the chevron returns to the room.
    await openPin(gardenReply, 'seed catalogue');
    await expectAt(page, inThreadOf(garden, gardenRoot), 'the pinned reply opens its thread');
    // The same pin from inside that thread stays in it.
    await openPin(gardenReply, 'seed catalogue');
    await expectAt(page, inThreadOf(garden, gardenRoot), 'the pinned reply keeps its thread');
    await threadBack(page).tap();
    await shoot(page, testInfo, 'pin-thread-back');
    await expectAt(page, inRoom(garden), 'the thread chevron returns to the room');

    // A pinned message of the room's own timeline stays in the room; the chevron leaves it.
    await openPin(gardenNote, 'planting rota');
    await expectAt(page, inRoom(garden), 'the pinned message opens in the room');
    await roomBack(page).tap();
    await expectAt(page, HOME, 'the room chevron returns to the list');
    await browserBackLeaves(page, garden, 'browser back after the chevron leaves the list');
  },

  'Jump to Time': async (page, { garden, gardenRoot }, testInfo) => {
    const jump = async () => {
      await page.getByRole('button', { name: 'More Options' }).first().tap();
      await page.getByRole('menuitem', { name: 'Jump to Time' }).tap();
      const dialog = page.getByRole('dialog', { name: 'Jump to Time' });
      await dialog.getByRole('button', { name: 'Beginning' }).tap();
      await dialog.getByRole('button', { name: 'Open Timeline' }).tap();
      await expect(dialog).toBeHidden();
    };

    // In a thread, the thread moves to its first message and its chevron still returns to the room.
    await openFromList(page, 'Garden Club', garden);
    await openThread(page, garden, gardenRoot);
    await jump();
    await expectAt(page, inThreadOf(garden, gardenRoot), 'Jump to Time keeps the thread');
    await threadBack(page).tap();
    await expectAt(page, inRoom(garden), 'the thread chevron returns to the room');

    // In the room, the Full view opens at the room's start; the chevron leaves the room.
    await jump();
    await expect(page).toHaveURL(/%24|\$/);
    await expectAt(page, inRoom(garden), 'Jump to Time stays in the room');
    await roomBack(page).tap();
    await shoot(page, testInfo, 'jump-room-back');
    await expectAt(page, HOME, 'the room chevron returns to the list');
    await browserBackLeaves(page, garden, 'browser back after the chevron leaves the list');
  },
};

const signIn = async (browser: Browser, seed: Seed) => {
  const context = await browser.newContext(PHONE);
  context.setDefaultTimeout(30_000);
  await context.addInitScript(recordNotifications);
  const page = await context.newPage();
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seed.username,
    password: PASSWORD,
  });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await page.goto('/home/');
  await expect(
    page.getByTestId('resizable-page-nav').getByRole('link', { name: 'Harbor Plans' })
  ).toBeVisible({ timeout: 60_000 });
  return { context, page };
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

for (const engine of ENGINES) {
  for (const [entry, flow] of Object.entries(FLOWS)) {
    test(`${engine}: back from ${entry} leads to the room, then where it was opened from`, async ({
      browser,
    }, testInfo) => {
      test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
      test.setTimeout(240_000);
      const own = engine === 'webkit' ? await launchWebKit() : browser;
      try {
        const seed = await seeded(engine);
        const { context, page } = await signIn(own, seed);
        try {
          await flow(page, seed, testInfo, engine);
        } finally {
          await shoot(page, testInfo, 'last');
          await context.close();
        }
      } finally {
        if (engine === 'webkit') await own.close();
      }
    });
  }
}
