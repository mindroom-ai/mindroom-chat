import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

/**
 * A room's timeline begins with its start: the room intro (its picture, name and topic) above the
 * first row, or in the Compact view of a room without any thread the "No threads" box. A short
 * room, whose creation event comes with the first sync, shows it at the top of its rows as soon
 * as the reader is there, whether it opens at its newest row or at the reader's first unread
 * message; a long room shows it only once the reader has paged back to the start.
 *
 * The first sync of a short room holds every event from the room's creation on, with a token to
 * page further back (the server marks it limited all the same). The timeline showed the start
 * only once a page back from that token came back empty, and none came: the opening fill does not
 * page ahead of a room whose creation it holds, and when the room opened with the back sentinel
 * just under the room header (its rows a little taller than the screen, or the view at the first
 * unread message), the paginator never looked at the sentinel again as the reader scrolled it
 * into view. The client's own offline download asks for its first page without a token, so it
 * moved nothing either. The start never showed, also with the reader at the top for 30 seconds.
 *
 * Checked in the Classic, Threads and Compact views, at desktop size with classic scrollbars and
 * on a touch phone, in Chromium and, when the runner names it, in WebKit. Set
 * ROOM_INTRO_SHOTS=<directory> to save each room at its start.
 */

const PASSWORD = 'room-intro-start-1';
const SHOTS = process.env.ROOM_INTRO_SHOTS;
const homeserver = getHomeserver();
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
type Device = 'desktop' | 'phone';
type ViewMode = 'classic' | 'threaded' | 'compact';
/**
 * More than the first sync (20 events) and the opening fill's page (200) bring together, so the
 * room's creation loads only once the reader pages back to it.
 */
const LONG_ROOM_MESSAGES = 250;

type Account = { username: string; userId: string; accessToken: string };
type ShortRoom = { roomId: string; newest: string; topic: string };
type Fixture = {
  viewer: Account;
  /** Creation, settings, a member who joins, two messages, the newest the reader's own. */
  readRoom: ShortRoom;
  /** Per test: the same, but the member's three messages are new to the reader. */
  unreadRooms: Map<string, ShortRoom>;
  /** Creation and settings only: a room without any thread. */
  emptyRoom: { roomId: string; topic: string };
  /** The short room's start, then `LONG_ROOM_MESSAGES` messages. */
  longRoom: { roomId: string; first: string; newest: string; topic: string };
};

const register = async (prefix: string, displayname: string): Promise<Account> => {
  const username = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const result = await matrixFetch<{ user_id: string; access_token: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(homeserver, `/profile/${encodeURIComponent(result.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: result.access_token,
    body: JSON.stringify({ displayname }),
  });
  return { username, userId: result.user_id, accessToken: result.access_token };
};

const NOTES = [
  'The release checklist is in the pinned notes. Check each item before publishing the build.',
  'Totals for the quarter are in the ledger. The travel line still needs two receipts.',
  'I moved the review to Thursday morning so the design team can join after their standup.',
  'Can someone confirm the staging deploy finished? The health check still shows the old version.',
  'Draft of the summary is ready for comments. It covers the migration plan and the rollback steps.',
];
const note = (index: number) => ({
  msgtype: 'm.text',
  body: `${NOTES[index % NOTES.length] ?? ''} (${index + 1})`,
});

/** Rooms whose every event comes with the first sync; each test opens its own unread one. */
const SHORT_ROOM_TESTS = ['classic', 'threaded'].flatMap((mode) =>
  ['chromium', 'webkit'].flatMap((engine) =>
    ['desktop', 'phone'].map((device) => `${mode}-${engine}-${device}`)
  )
);

const seed = async (): Promise<Fixture> => {
  const viewer = await register('intro_reader', 'Robin Reader');
  const member = await register('intro_member', 'Avery Quinn');
  // A realistic account: the room list holds 25 other rooms.
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createPrivateRoom(homeserver, viewer.accessToken, {
        name: `Project ${index + 1}`,
        topic: 'Planning and release updates',
      })
    )
  );

  // The newest message is the reader's own (read), or the member wrote all three (unread).
  const shortRoom = async (name: string, topic: string, unread: boolean): Promise<ShortRoom> => {
    const roomId = await createPrivateRoom(homeserver, viewer.accessToken, {
      name,
      topic,
      invite: [member.userId],
    });
    await joinRoom(homeserver, member.accessToken, roomId);
    const later = unread ? member : viewer;
    await sendRoomMessage(homeserver, member.accessToken, roomId, note(1));
    await sendRoomMessage(homeserver, later.accessToken, roomId, note(2));
    const newest = await sendRoomMessage(homeserver, later.accessToken, roomId, note(3));
    return { roomId, newest, topic };
  };
  const readRoom = await shortRoom('Quarter close', 'Where we keep the close checklist', false);
  const unreadRooms = new Map<string, ShortRoom>();
  for (const name of SHORT_ROOM_TESTS) {
    // eslint-disable-next-line no-await-in-loop
    unreadRooms.set(name, await shortRoom(`Budget ${name}`, 'Numbers for the next review', true));
  }

  const emptyTopic = 'Nothing here yet';
  const emptyId = await createPrivateRoom(homeserver, viewer.accessToken, {
    name: 'Fresh room',
    topic: emptyTopic,
  });

  const longTopic = 'Daily notes from the release team';
  const longId = await createPrivateRoom(homeserver, viewer.accessToken, {
    name: 'Release diary',
    topic: longTopic,
    invite: [member.userId],
  });
  await joinRoom(homeserver, member.accessToken, longId);
  const sent: string[] = [];
  for (let index = 0; index < LONG_ROOM_MESSAGES; index += 1) {
    const sender = index % 2 === 0 ? member : viewer;
    // eslint-disable-next-line no-await-in-loop
    sent.push(await sendRoomMessage(homeserver, sender.accessToken, longId, note(index)));
  }

  return {
    viewer,
    readRoom,
    unreadRooms,
    emptyRoom: { roomId: emptyId, topic: emptyTopic },
    longRoom: {
      roomId: longId,
      first: sent[0] ?? '',
      newest: sent[sent.length - 1] ?? '',
      topic: longTopic,
    },
  };
};

/** Where the start block and the scroll area are, for the failure message. */
const readStart = (page: Page, selector: string) =>
  page.evaluate((startSelector) => {
    const inner = document.querySelector('[data-testid="room-virtual-inner"]');
    let view = inner?.parentElement ?? null;
    while (view && !['auto', 'scroll'].includes(getComputedStyle(view).overflowY))
      view = view.parentElement;
    const start = document.querySelector(startSelector);
    if (!view) return { scroller: false, start: !!start, inBand: false };
    const style = getComputedStyle(view);
    const box = view.getBoundingClientRect();
    const bandTop = box.top + (Number.parseFloat(style.scrollPaddingTop) || 0);
    const bandBottom = box.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0);
    const rect = start?.getBoundingClientRect();
    const sentinel = view.querySelector('[data-paginator-anchor="B"]')?.getBoundingClientRect();
    return {
      scroller: true,
      start: !!start,
      inBand: !!rect && rect.height > 0 && rect.bottom > bandTop && rect.top < bandBottom,
      scrollTop: Math.round(view.scrollTop),
      scrollHeight: Math.round(view.scrollHeight),
      clientHeight: Math.round(view.clientHeight),
      bandTop: Math.round(bandTop),
      bandBottom: Math.round(bandBottom),
      sentinelTop: sentinel ? Math.round(sentinel.top) : null,
    };
  }, selector);

/**
 * One flick upward: eight wheel notches 40 ms apart on a desktop. A phone has no wheel (mobile
 * WebKit refuses one), so there a finger touches the timeline, moves it in eight steps and lifts.
 */
const flickUp = async (page: Page, device: Device) => {
  const view = page.getByTestId('room-virtual-inner');
  if (device === 'phone')
    await view.evaluate((inner) => inner.dispatchEvent(new Event('touchstart', { bubbles: true })));
  for (let notch = 0; notch < 8; notch += 1) {
    if (device === 'desktop') {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -320);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await view.evaluate((inner) => {
        let node = inner.parentElement;
        while (node && !['auto', 'scroll'].includes(getComputedStyle(node).overflowY))
          node = node.parentElement;
        node?.scrollBy({ top: -320 });
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(40);
  }
  if (device === 'phone')
    await view.evaluate((inner) => inner.dispatchEvent(new Event('touchend', { bubbles: true })));
};

const INTRO = '[data-room-intro]';
const NO_THREADS = '[data-compact-room-without-threads]';

/**
 * Scrolls up like a reader until the start block is in the visible band, or until three flicks
 * in a row found the reader at the top with nothing new above, or for `flicks` flicks; then waits
 * up to `settleMs` for it with the reader at the top.
 */
const readUpToStart = async (
  page: Page,
  device: Device,
  selector: string,
  label: string,
  flicks: number,
  settleMs = 15_000
) => {
  const box = await page.getByTestId('room-virtual-inner').boundingBox();
  if (box && device === 'desktop')
    await page.mouse.move(box.x + box.width / 2, Math.max(box.y, 200) + 40);
  let atTop = 0;
  let height = 0;
  for (let flick = 0; flick < flicks && atTop < 3; flick += 1) {
    // eslint-disable-next-line no-await-in-loop
    const now = await readStart(page, selector);
    if (now.inBand) break;
    atTop = now.scrollTop === 0 && now.scrollHeight === height ? atTop + 1 : 0;
    height = now.scrollHeight ?? 0;
    // eslint-disable-next-line no-await-in-loop
    await flickUp(page, device);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(400);
  }
  let last = await readStart(page, selector);
  const deadline = Date.now() + settleMs;
  while (!last.inBand && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
    // eslint-disable-next-line no-await-in-loop
    last = await readStart(page, selector);
  }
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}.png` });
  }
  expect(
    last.inBand,
    `${label}: the room's start in view at the top: ${JSON.stringify(last)}`
  ).toBe(true);
};

const openRoom = async (page: Page, fixture: Fixture, roomId: string, mode: ViewMode) => {
  await seedRoomOverviewState({
    page,
    roomId,
    userId: fixture.viewer.userId,
    viewMode: mode,
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
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

test.describe("a room's timeline begins with its start", () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    let reachable = false;
    try {
      reachable = (await fetch(`${homeserver}/_matrix/client/versions`)).ok;
    } catch {
      reachable = false;
    }
    test.skip(!reachable, `No homeserver at ${homeserver}`);
    fixture = await seed();
  });

  const cases = [
    { engine: 'chromium', device: 'desktop' },
    { engine: 'chromium', device: 'phone' },
    { engine: 'webkit', device: 'desktop' },
    { engine: 'webkit', device: 'phone' },
  ] as const;
  cases.forEach(({ engine, device }) => {
    (['classic', 'threaded', 'compact'] as const).forEach((mode) => {
      test(`${mode} view, ${engine}, ${device}`, async ({ browser, baseURL }) => {
        test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
        test.setTimeout(300_000);
        const options = { ...(device === 'phone' ? PHONE : DESKTOP), baseURL };
        const host = engine === 'webkit' ? await launchWebKit() : undefined;
        const context = await (host ?? browser).newContext(options);
        const label = `${mode}-${engine}-${device}`;
        try {
          const page = await context.newPage();
          await loginWithPassword(page, {
            homeserver,
            username: fixture.viewer.username,
            password: PASSWORD,
          });

          if (mode === 'compact') {
            // A room without any thread says so at its start, under the filter bar.
            await openRoom(page, fixture, fixture.emptyRoom.roomId, mode);
            await expect(page.getByTestId('room-virtual-inner')).toBeAttached({ timeout: 60_000 });
            await readUpToStart(page, device, NO_THREADS, `${label}-empty`, 0);
            return;
          }

          // The short rooms: the start shows above their rows, when the room opens at its newest
          // row and when it opens at the reader's first unread message.
          const unreadRoom = fixture.unreadRooms.get(label);
          for (const [room, kind] of [
            [unreadRoom, 'unread'],
            [fixture.readRoom, 'read'],
          ] as const) {
            if (!room) throw new Error(`No unread room for ${label}`);
            // eslint-disable-next-line no-await-in-loop
            await openRoom(page, fixture, room.roomId, mode);
            // eslint-disable-next-line no-await-in-loop
            await expect(page.locator(`[data-message-id="${room.newest}"]`)).toBeAttached({
              timeout: 60_000,
            });
            // eslint-disable-next-line no-await-in-loop
            await readUpToStart(page, device, INTRO, `${label}-${kind}`, 6);
            // eslint-disable-next-line no-await-in-loop
            await expect(page.locator(INTRO)).toContainText(room.topic);
          }

          // The long room: no start while its creation is not loaded, then the start once the
          // reader has paged back to it, above the room's first message.
          await openRoom(page, fixture, fixture.longRoom.roomId, mode);
          await expect(page.locator(`[data-message-id="${fixture.longRoom.newest}"]`)).toBeVisible({
            timeout: 60_000,
          });
          await page.waitForTimeout(2_000);
          await expect(
            page.locator(INTRO),
            `${label}-long: no start at the newest rows`
          ).toHaveCount(0);
          await readUpToStart(page, device, INTRO, `${label}-long`, 150);
          await expect(page.locator(INTRO)).toContainText(fixture.longRoom.topic);
          if (mode === 'classic') {
            const intro = await page.locator(INTRO).boundingBox();
            const first = await page
              .locator(`[data-message-id="${fixture.longRoom.first}"]`)
              .boundingBox();
            expect(first, `${label}-long: the first message is shown`).not.toBeNull();
            expect((intro?.y ?? 0) < (first?.y ?? 0), `${label}-long: start above it`).toBe(true);
          }
        } finally {
          await context.close();
          await host?.close();
        }
      });
    });
  });
});
