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
 * A long room that opens at the reader's first unread message loads its older history as the
 * reader scrolls up, all the way to the room's first message. The room's newest rows (the ones the
 * first sync brings) are short, so they stand a little taller than the screen, and the view opens
 * with the "load older" sentinel close above the first unread row, also just under the room
 * header. Checked with few and with more unread messages, in the Classic and Threads views, at
 * desktop size with classic scrollbars and on a touch phone, in Chromium and, when the runner
 * names it, in WebKit. Set ROOM_HISTORY_UNREAD_SHOTS=<directory> to save each room at its start.
 */

const PASSWORD = 'room-history-from-unread-1';
const SHOTS = process.env.ROOM_HISTORY_UNREAD_SHOTS;
const homeserver = getHomeserver();
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
type Device = 'desktop' | 'phone';
type ViewMode = 'classic' | 'threaded';
/** More than the first sync (20 events) and one page of history (200) bring together. */
const MESSAGES = 250;
/** The newest events, the ones the first sync brings: short lines. */
const SYNCED = 20;
/** Unread messages at the end of each room. */
const UNREAD = [3, 9] as const;

type Account = { username: string; userId: string; accessToken: string };
type LongRoom = { roomId: string; first: string; firstUnread: string };

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
const SHORT = ['Noted', 'Thanks, on it', 'Looks good', 'Done', 'Will check after lunch'];
const text = (body: string) => ({ msgtype: 'm.text', body });

/**
 * A long room: notes from two people, then `SYNCED` short lines, the last `unread` of them new
 * to the viewer, whose read receipt sits on the line before them.
 */
const seedRoom = async (
  viewer: Account,
  member: Account,
  name: string,
  unread: number
): Promise<LongRoom> => {
  const roomId = await createPrivateRoom(homeserver, viewer.accessToken, {
    name,
    topic: 'Daily notes from the release team',
    invite: [member.userId],
  });
  await joinRoom(homeserver, member.accessToken, roomId);
  const sent: string[] = [];
  for (let index = 0; index < MESSAGES; index += 1) {
    const isUnread = index >= MESSAGES - unread;
    // The line before the unread ones is the viewer's own.
    const sender =
      isUnread || (index % 2 === 0 && index !== MESSAGES - unread - 1) ? member : viewer;
    const body =
      index < MESSAGES - SYNCED
        ? `${NOTES[index % NOTES.length] ?? ''} (${index + 1})`
        : `${SHORT[index % SHORT.length] ?? ''} (${index + 1})`;
    // eslint-disable-next-line no-await-in-loop
    sent.push(await sendRoomMessage(homeserver, sender.accessToken, roomId, text(body)));
  }
  const lastRead = sent[MESSAGES - unread - 1] ?? '';
  const room = encodeURIComponent(roomId);
  await matrixFetch(homeserver, `/rooms/${room}/receipt/m.read/${encodeURIComponent(lastRead)}`, {
    method: 'POST',
    accessToken: viewer.accessToken,
    body: JSON.stringify({}),
  });
  await matrixFetch(homeserver, `/rooms/${room}/read_markers`, {
    method: 'POST',
    accessToken: viewer.accessToken,
    body: JSON.stringify({ 'm.fully_read': lastRead, 'm.read': lastRead }),
  });
  return { roomId, first: sent[0] ?? '', firstUnread: sent[MESSAGES - unread] ?? '' };
};

const CASES = (['classic', 'threaded'] as const).flatMap((mode) =>
  (['chromium', 'webkit'] as const).flatMap((engine) =>
    (['desktop', 'phone'] as const).map((device) => ({ mode, engine, device }))
  )
);
const caseName = ({ mode, engine, device }: (typeof CASES)[number]) =>
  `${mode}-${engine}-${device}`;

type Fixture = { viewer: Account; rooms: Map<string, LongRoom> };

const seed = async (): Promise<Fixture> => {
  const viewer = await register('unread_reader', 'Robin Reader');
  const member = await register('unread_member', 'Avery Quinn');
  // A realistic account: the room list holds 25 other rooms.
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createPrivateRoom(homeserver, viewer.accessToken, {
        name: `Project ${index + 1}`,
        topic: 'Planning and release updates',
      })
    )
  );
  // Each test reads its own rooms: reading one sends receipts.
  const keys = CASES.flatMap((one) => UNREAD.map((unread) => `${caseName(one)}-${unread}`));
  const seeded = await Promise.all(
    keys.map((key) => seedRoom(viewer, member, `Release diary ${key}`, Number(key.split('-')[3])))
  );
  return { viewer, rooms: new Map(keys.map((key, index) => [key, seeded[index] as LongRoom])) };
};

/** Where `selector`, the scroll area and the "load older" sentinel are. */
const readView = (page: Page, selector: string) =>
  page.evaluate((target) => {
    const inner = document.querySelector('[data-testid="room-virtual-inner"]');
    let view = inner?.parentElement ?? null;
    while (view && !['auto', 'scroll'].includes(getComputedStyle(view).overflowY))
      view = view.parentElement;
    if (!view) return { scroller: false, inBand: false };
    const style = getComputedStyle(view);
    const box = view.getBoundingClientRect();
    const bandTop = box.top + (Number.parseFloat(style.scrollPaddingTop) || 0);
    const bandBottom = box.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0);
    const rect = document.querySelector(target)?.getBoundingClientRect();
    const sentinel = view.querySelector('[data-paginator-anchor="B"]')?.getBoundingClientRect();
    return {
      scroller: true,
      inBand: !!rect && rect.height > 0 && rect.bottom > bandTop && rect.top < bandBottom,
      scrollTop: Math.round(view.scrollTop),
      scrollHeight: Math.round(view.scrollHeight),
      clientHeight: Math.round(view.clientHeight),
      bandTop: Math.round(bandTop),
      sentinelTop: sentinel ? Math.round(sentinel.top) : null,
      rows: view.querySelectorAll('[data-message-id]').length,
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

/**
 * Scrolls up like a reader until `selector` is in the visible band, or until ten flicks in a row
 * found the reader at the top with nothing new above; then waits up to 15 s for it there.
 */
const readUpTo = async (page: Page, device: Device, selector: string, label: string) => {
  const box = await page.getByTestId('room-virtual-inner').boundingBox();
  if (box && device === 'desktop')
    await page.mouse.move(box.x + box.width / 2, Math.max(box.y, 200) + 40);
  const trace: string[] = [];
  let atTop = 0;
  let height = 0;
  for (let flick = 0; flick < 80 && atTop < 10; flick += 1) {
    // eslint-disable-next-line no-await-in-loop
    const now = await readView(page, selector);
    trace.push(JSON.stringify(now));
    if (now.inBand) break;
    atTop = now.scrollTop === 0 && now.scrollHeight === height ? atTop + 1 : 0;
    height = now.scrollHeight ?? 0;
    // eslint-disable-next-line no-await-in-loop
    await flickUp(page, device);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(400);
  }
  let last = await readView(page, selector);
  const deadline = Date.now() + 15_000;
  while (!last.inBand && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
    // eslint-disable-next-line no-await-in-loop
    last = await readView(page, selector);
  }
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}.png` });
  }
  expect(
    last.inBand,
    `${label}: the room's first message in view: ${JSON.stringify(last)}\n${trace
      .slice(0, 12)
      .join('\n')}`
  ).toBe(true);
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

test.describe('a long room opened at its first unread message reads back to its start', () => {
  test.beforeAll(async () => {
    test.setTimeout(600_000);
    let reachable = false;
    try {
      reachable = (await fetch(`${homeserver}/_matrix/client/versions`)).ok;
    } catch {
      reachable = false;
    }
    test.skip(!reachable, `No homeserver at ${homeserver}`);
    fixture = await seed();
  });

  CASES.forEach((one) => {
    const { mode, engine, device } = one;
    test(`${mode} view, ${engine}, ${device}`, async ({ browser, baseURL }) => {
      test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
      test.setTimeout(400_000);
      const options = { ...(device === 'phone' ? PHONE : DESKTOP), baseURL };
      const host = engine === 'webkit' ? await launchWebKit() : undefined;
      const context = await (host ?? browser).newContext(options);
      try {
        const page = await context.newPage();
        await loginWithPassword(page, {
          homeserver,
          username: fixture.viewer.username,
          password: PASSWORD,
        });
        for (const unread of UNREAD) {
          const label = `${caseName(one)}-${unread}`;
          const room = fixture.rooms.get(label);
          if (!room) throw new Error(`No room for ${label}`);
          // eslint-disable-next-line no-await-in-loop
          await seedRoomOverviewState({
            page,
            roomId: room.roomId,
            userId: fixture.viewer.userId,
            viewMode: mode as ViewMode,
            filterState: createDefaultThreadFilterState(),
          });
          // eslint-disable-next-line no-await-in-loop
          await page.goto(`/home/${encodeURIComponent(room.roomId)}`);
          // eslint-disable-next-line no-await-in-loop
          await expect(page.locator(`[data-message-id="${room.firstUnread}"]`)).toBeVisible({
            timeout: 60_000,
          });
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(1_500);
          // eslint-disable-next-line no-await-in-loop
          await readUpTo(page, device, `[data-message-id="${room.first}"]`, label);
        }
      } finally {
        await context.close();
        await host?.close();
      }
    });
  });
});
