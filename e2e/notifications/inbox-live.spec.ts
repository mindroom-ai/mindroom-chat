import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, loginToMatrix, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (P3-lane2-F002): Inbox > Notifications showed the read flags of its last load. Rows
// read on another device kept their dot for as long as the page stayed open, and a notification
// that arrived meanwhile did not show; only reopening the page did. The open page now follows the
// server (its /notifications is the truth): another device of the reader reads a thread and the
// main timeline of Support Room, and the four rows of that room lose their dot while the page
// stays open. New notifications then join the list: at the top, in view, for a reader at the top;
// above the view for a reader scrolled down, whose rows in view keep their places; and above the
// row under the reader's pointer (a resting mouse, a finger on the screen), which keeps its place.
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit, each on a
// desktop (1440 by 900, classic scrollbars) and a phone (390 by 844, touch), against the
// disposable homeserver of a slot (scripts/e2e-slot.sh). Set INBOX_LIVE_SHOTS to a directory to
// save the page after the other device read the room.
const PASSWORD = 'inbox-live-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.INBOX_LIVE_SHOTS;
const FILLER_ROOMS = 25;
const RELEASE_NOTES = 24;
/** How long the open page may take to follow a change: a sync or two and the page's refresh. */
const FOLLOW_MS = 15_000;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 900 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
};

const RELEASE_TOPICS = [
  'the export dialog now remembers the last folder you picked',
  'large tables load in pages of fifty rows instead of all at once',
  'the search field keeps its text when you switch between tabs',
  'dates in the activity list follow the language you chose',
  'the upload button shows how far a big file has come',
  'keyboard focus returns to the list after a dialog closes',
];

type World = {
  reader: DisposableUser;
  writer: DisposableUser;
  supportId: string;
  rootId: string;
  newestReplyId: string;
  newestMainId: string;
};

const seed = async (name: string): Promise<World> => {
  const reader = await registerDisposableUser(`inl_${name}_${RUN}`, PASSWORD);
  const writer = await registerDisposableUser(`inl_w_${name}_${RUN}`, PASSWORD);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  const shared = async (roomName: string) => {
    const roomId = await createRoom(HOMESERVER, writer.accessToken, {
      name: roomName,
      invite: [reader.userId],
    });
    await joinRoom(HOMESERVER, reader.accessToken, roomId);
    return roomId;
  };
  const notesId = await shared('Release Notes');
  const supportId = await shared('Support Room');
  for (let index = 1; index <= RELEASE_NOTES; index += 1) {
    await sendRoomMessage(HOMESERVER, writer.accessToken, notesId, {
      msgtype: 'm.text',
      body: `Release note ${index}: ${
        RELEASE_TOPICS[index % RELEASE_TOPICS.length]
      }, and the change is live for everyone since this morning.`,
    });
  }
  const send = (body: string, rootId?: string) =>
    sendRoomMessage(HOMESERVER, writer.accessToken, supportId, {
      msgtype: 'm.text',
      body,
      ...(rootId
        ? {
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: rootId,
              is_falling_back: true,
              'm.in_reply_to': { event_id: rootId },
            },
          }
        : {}),
    });
  const rootId = await send('The export to CSV drops the last column when a cell holds a comma.');
  await send('It happens in both the web app and the desktop app, since Monday.', rootId);
  const newestReplyId = await send(
    'The quoting change from last week looks like the cause; a fix is in review.',
    rootId
  );
  const newestMainId = await send('Could someone confirm the fix on the staging server today?');
  return { reader, writer, supportId, rootId, newestReplyId, newestMainId };
};

/**
 * The read flags of the reader's message notifications in Support Room, as the server lists them
 * (the invite notifies too; the Inbox leaves state events out).
 */
const serverFlags = async (world: World): Promise<boolean[]> => {
  const { notifications } = await matrixFetch<{
    notifications: { room_id: string; read: boolean; event: { type: string } }[];
  }>(HOMESERVER, '/notifications?limit=100', { accessToken: world.reader.accessToken });
  return notifications
    .filter(
      ({ room_id: roomId, event }) => roomId === world.supportId && event.type === 'm.room.message'
    )
    .map((notification) => notification.read);
};

/** Moves within the app without reloading it, as its own links do. */
const openPath = (page: Page, path: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

/** The top of the message whose text starts with `text`, on screen. */
const topOf = (page: Page, text: string): Promise<number> =>
  page.getByText(text).evaluate((element) => element.getBoundingClientRect().top);

/** The scrolling element around the notifications, found from a message in it. */
const scrollList = (page: Page, text: string, to: 'center' | 'top') =>
  page.getByText(text).evaluate((element, where) => {
    const scrolls = (box: HTMLElement) =>
      box.scrollHeight > box.clientHeight + 1 &&
      /auto|scroll/.test(getComputedStyle(box).overflowY);
    let view = element.parentElement;
    while (view && !scrolls(view)) view = view.parentElement;
    if (!view) throw new Error('no scrolling list');
    if (where === 'top') view.scrollTop = 0;
    else element.scrollIntoView({ block: 'center' });
    return view.scrollTop;
  }, to);

/** Whether the message whose text starts with `text` is inside the window. */
const inView = (page: Page, text: string): Promise<boolean> =>
  page.getByText(text).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  });

const check = async (
  browser: Browser,
  baseURL: string | undefined,
  name: string,
  options: BrowserContextOptions
) => {
  const world = await seed(name);
  const touch = !!options.hasTouch;
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...world.reader });
    await openPath(page, '/inbox/notifications/');
    const rows = page.getByRole('button', { name: 'Open', exact: true });
    const dots = page.getByRole('img', { name: 'Unread', exact: true });
    const markAsRead = page.getByRole('button', { name: 'Mark as Read', exact: true });
    await expect(rows).toHaveCount(RELEASE_NOTES + 4, { timeout: 60_000 });
    await expect(dots).toHaveCount(RELEASE_NOTES + 4);
    await expect(markAsRead).toHaveCount(2);

    // Another device of the reader reads the thread up to its newest reply, then the main timeline.
    const otherDevice = await loginToMatrix(HOMESERVER, world.reader.username, PASSWORD);
    const readElsewhere = (eventId: string, threadId: string) =>
      matrixFetch(
        HOMESERVER,
        `/rooms/${encodeURIComponent(world.supportId)}/receipt/m.read/${encodeURIComponent(
          eventId
        )}`,
        {
          method: 'POST',
          accessToken: otherDevice.accessToken,
          body: JSON.stringify({ thread_id: threadId }),
        }
      );
    await readElsewhere(world.newestReplyId, world.rootId);
    await readElsewhere(world.newestMainId, 'main');
    await expect.poll(() => serverFlags(world), { timeout: 15_000 }).toEqual(Array(4).fill(true));

    // The open page follows: Support Room's four rows lose their dot, and its chip goes.
    await expect(dots).toHaveCount(RELEASE_NOTES, { timeout: FOLLOW_MS });
    await expect(markAsRead).toHaveCount(1);
    await expect(rows).toHaveCount(RELEASE_NOTES + 4);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/inbox-live-${name}-read-elsewhere.png` });

    const newMessage = (body: string) =>
      sendRoomMessage(HOMESERVER, world.writer.accessToken, world.supportId, {
        msgtype: 'm.text',
        body,
      });

    // Scrolled down, a new notification joins above the view; the rows in view stay put.
    const middle = 'Release note 12:';
    expect(await scrollList(page, middle, 'center')).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    const middleTop = await topOf(page, middle);
    await newMessage('First follow-up: the staging server has the fix now.');
    await expect(rows).toHaveCount(RELEASE_NOTES + 5, { timeout: FOLLOW_MS });
    await expect(page.getByText('First follow-up:')).toHaveCount(1);
    expect(Math.abs((await topOf(page, middle)) - middleTop)).toBeLessThan(1);

    // At the top, the next one shows at the top, in view.
    await scrollList(page, middle, 'top');
    await page.waitForTimeout(300);
    await newMessage('Second follow-up: the fix is confirmed on staging.');
    await expect(rows).toHaveCount(RELEASE_NOTES + 6, { timeout: FOLLOW_MS });
    await expect.poll(() => inView(page, 'Second follow-up:')).toBe(true);

    // A pointer rests on a row (a finger on the screen, on a phone): that row keeps its place even
    // at the top, and the new notification joins above it.
    const pointed = 'Could someone confirm the fix';
    const box = await page.getByText(pointed).boundingBox();
    if (!box) throw new Error('the pointed row is not shown');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (touch) {
      // Playwright's touchscreen only taps; a finger that stays down is a pointerdown without its up.
      await page.evaluate(
        ({ clientX, clientY }) => {
          const target = document.elementFromPoint(clientX, clientY);
          target?.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              pointerType: 'touch',
              isPrimary: true,
              clientX,
              clientY,
            })
          );
        },
        { clientX: x, clientY: y }
      );
    } else {
      await page.mouse.move(x, y);
    }
    const pointedTop = await topOf(page, pointed);
    await newMessage('Third follow-up: the release goes out on Thursday.');
    await expect(rows).toHaveCount(RELEASE_NOTES + 7, { timeout: FOLLOW_MS });
    expect(Math.abs((await topOf(page, pointed)) - pointedTop)).toBeLessThan(1);
  } finally {
    await context.close();
  }
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const [size, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`the open Inbox follows reads elsewhere and new notifications (Chromium, ${size})`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    await check(browser, baseURL, `chromium_${size}`, options);
  });

  test(`the open Inbox follows reads elsewhere and new notifications (WebKit, ${size})`, async ({
    baseURL,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(240_000);
    const browser = await launchWebKit();
    try {
      await check(browser, baseURL, `webkit_${size}`, options);
    } finally {
      await browser.close();
    }
  });
}
