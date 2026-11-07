import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';

// On a phone, a swipe from the screen's left edge leaves a room the way the room's back chevron
// does: to the list it was opened from, or to the room it was opened over. The iOS app's web view
// has no back gesture of its own, so this swipe is the only one there. A thread open in the room
// takes the swipe itself and steps back to the room only. 390 by 844 with touch, in Chromium with
// real touches and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'phone-room-edge-swipe-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const ENGINES = ['chromium', 'webkit'] as const;
type Engine = (typeof ENGINES)[number];

// A list long enough to scroll, as a real account's is.
const OTHER_ROOMS = Array.from(
  { length: 24 },
  (_, index) => `Neighborhood Group ${String(index + 1).padStart(2, '0')}`
);

type Seed = { username: string; garden: string; gardenRoot: string; harbor: string };

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

const text = (body: string) => ({ msgtype: 'm.text', body });

const seed = async (engine: Engine): Promise<Seed> => {
  const username = `pres_${engine}_${RUN}`;
  const reader = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const create = (name: string, invite?: string[]) =>
    createPrivateRoom(HOMESERVER, reader.access_token, { name, topic: `${name} notes`, invite });
  // The rooms have an agent, as MindRoom rooms do, so they open in Compact.
  const agent = await registerAgentAccount(HOMESERVER, `pres${engine[0]}`);
  const say = (roomId: string, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, reader.access_token, roomId, content, 'phone-room-edge-swipe');

  await Promise.all(OTHER_ROOMS.map((name) => create(name)));
  const garden = await create('Garden Club', [agent.userId]);
  const gardenRoot = await say(
    garden,
    text('Seed order for spring: tomatoes, beans and two kinds of squash. Anything else by Friday?')
  );
  await say(garden, {
    ...text('Add marigolds for the border, please; the old packets failed.'),
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: gardenRoot,
      is_falling_back: true,
      'm.in_reply_to': { event_id: gardenRoot },
    },
  });
  const harbor = await create('Harbor Plans', [agent.userId]);
  await say(harbor, text('Crane schedule for the north pier next week: who still needs a slot?'));
  return { username, garden, gardenRoot, harbor };
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

const expectAt = (page: Page, expected: Partial<Place>, step: string) =>
  expect.poll(() => place(page), { message: step, timeout: 20_000 }).toMatchObject(expected);

/** Waits a second, then checks nothing went back a second step. */
const expectStillAt = async (page: Page, expected: Partial<Place>, step: string) => {
  await page.waitForTimeout(1_000);
  await expectAt(page, expected, step);
};

const shoot = (page: Page, testInfo: TestInfo, name: string) =>
  page.screenshot({ path: testInfo.outputPath(`${name}.png`) });

const roomList = (page: Page) => page.getByTestId('resizable-page-nav');

const openFromList = async (page: Page, name: string, room: string) => {
  await roomList(page).getByRole('link', { name }).tap();
  await expectAt(page, inRoom(room), `${name} opens from the list`);
  await expect(page.getByRole('banner').getByRole('button', { name: 'Back' })).toBeVisible();
};

/**
 * A swipe from the screen's left edge toward the middle. Chromium gets real touches (12 moves of
 * 16 ms, as a finger makes them); Playwright drives WebKit's touches only through its taps, so
 * WebKit gets the events the app's gesture listens to, as the iOS app's web view delivers them.
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

const signIn = async (browser: Browser, { username }: Seed) => {
  const context = await browser.newContext(PHONE);
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await page.goto('/home/');
  await expect(roomList(page).getByRole('link', { name: 'Harbor Plans' })).toBeVisible({
    timeout: 60_000,
  });
  return { context, page };
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

for (const engine of ENGINES) {
  test(`${engine}: a swipe from the left edge leaves a room as its back chevron does`, async ({
    browser,
  }, testInfo) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(240_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const seeded = await seed(engine);
      const { garden, gardenRoot, harbor } = seeded;
      const { context, page } = await signIn(own, seeded);
      try {
        // Opened from the list, the room goes back to the list.
        await openFromList(page, 'Garden Club', garden);
        await shoot(page, testInfo, 'room-before-swipe');
        await edgeSwipeBack(page, engine);
        await expectAt(page, HOME, 'the edge swipe returns to the list');
        await expect(roomList(page).getByRole('link', { name: 'Garden Club' })).toBeVisible();
        await shoot(page, testInfo, 'list-after-swipe');
        await expectStillAt(page, HOME, 'the edge swipe went back one step only');

        // Opened over another room, it goes back to that room, then the list.
        await openFromList(page, 'Harbor Plans', harbor);
        await pressPaletteShortcut(page);
        const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
        await palette.getByRole('combobox').fill('Garden Club');
        await palette
          .locator('[role="option"][data-kind="room"]')
          .filter({ hasText: 'Garden Club' })
          .tap();
        await expectAt(page, inRoom(garden), 'the palette opens the second room');
        await edgeSwipeBack(page, engine);
        await expectAt(page, inRoom(harbor), 'the edge swipe returns to the first room');
        await expectStillAt(page, inRoom(harbor), 'and stays there');
        await edgeSwipeBack(page, engine);
        await expectAt(page, HOME, 'a second swipe returns to the list');

        // In a thread, the swipe leaves the thread for its room, one step only.
        await openFromList(page, 'Garden Club', garden);
        await page.locator(`button[data-thread-root-id="${gardenRoot}"]`).first().tap();
        await expectAt(page, { room: garden, thread: gardenRoot }, 'the thread opens');
        await edgeSwipeBack(page, engine);
        await expectAt(page, inRoom(garden), 'the edge swipe leaves the thread for its room');
        await expectStillAt(page, inRoom(garden), 'and not the room too');
      } finally {
        await shoot(page, testInfo, 'last');
        await context.close();
      }
    } finally {
      if (engine === 'webkit') await own.close();
    }
  });
}
