import { mkdirSync, writeFileSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { openMessageMenu } from '../helpers/messageMenu';
import {
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Bidirectional controls (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C) change the
// order text shows in without showing themselves: `quarterly-report<U+202E>fdp.exe` reads as a
// PDF. Where the app previews a message on one line, each control shows as its code point, as in
// the message itself: the room list's name of a room, a system notification, Activity, the
// Threads list, reply quotes, the composer's reply bar and Compact cards. A member's message and
// a file's name hold the controls, and so does the room's name. Against the disposable homeserver
// of a slot, on a phone (390 by 844, touch) and a desktop (1280 by 800), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// DIRECTION_PREVIEWS_SHOTS=<directory> to save each view and the recorded notifications.
const PASSWORD = 'direction-previews-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.DIRECTION_PREVIEWS_SHOTS;
const FILLER_ROOMS = 24;
const HISTORY = 24;
const MEMBER_NAME = 'Avery Quinn';

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const CONTROL = /[؜‎‏‪-‮⁦-⁩]/;

const ROOM_NAME = 'Payroll ‮sevihcra‬';
const ROOM_NAME_SHOWN = 'Payroll <U+202E>sevihcra<U+202C>';
const PLAIN = 'Rename the report to invoice‮txt.exe‬ before it goes to the auditors.';
const PLAIN_SHOWN =
  'Rename the report to invoice<U+202E>txt.exe<U+202C> before it goes to the auditors.';
const FILE_NAME = 'quarterly-report‮fdp.exe';
const FILE_NAME_SHOWN = 'quarterly-report<U+202E>fdp.exe';
const FILE_TEXT = 'Quarterly notes\nAll receipts are filed.\n';

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string, displayName: string): Promise<Account> => {
  const username = `bidiprev_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  const session = await loginToMatrix(HOMESERVER, username, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
  return { ...session, username };
};

const upload = async (accessToken: string, text: string): Promise<string> => {
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'text/plain' },
    body: Buffer.from(text),
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { content_uri: string }).content_uri;
};

const fileContent = (body: string, url: string) => ({
  msgtype: 'm.file',
  body,
  url,
  info: { mimetype: 'text/plain', size: Buffer.byteLength(FILE_TEXT) },
});

type World = {
  reader: Account;
  member: Account;
  roomId: string;
  fileUrl: string;
  /** The member's message, a thread root whose newest reply is the member's file. */
  rootId: string;
  /** The member's file, in the room's own timeline. */
  fileId: string;
  /** The reader's replies to the message and to the file. */
  textReplyId: string;
  fileReplyId: string;
};

/**
 * Two people, alone in a room whose name holds controls (so every message of the member notifies
 * the reader), among 24 other rooms; 24 messages of history, then the member's message, their
 * file, the reader's replies to both, and a thread on the message: the reader's reply, then the
 * member's file again.
 */
const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(`reader_${engine}`, 'Robin Reader');
  const member = await registerAndLogin(`member_${engine}`, MEMBER_NAME);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [member.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Ledger room ${index}` });
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromMember = index % 4 === 0;
    await sendRoomMessage(HOMESERVER, (fromMember ? member : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromMember
        ? `Entry ${index}: the ledger balances for this week and the receipts are filed.`
        : `Entry ${index}: anything missing from the receipts this week?`,
    });
  }
  const fileUrl = await upload(member.accessToken, FILE_TEXT);
  const rootId = await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: PLAIN,
  });
  const fileId = await sendRoomMessage(
    HOMESERVER,
    member.accessToken,
    roomId,
    fileContent(FILE_NAME, fileUrl)
  );
  const reply = (eventId: string, body: string) =>
    sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body,
      'm.relates_to': { 'm.in_reply_to': { event_id: eventId } },
    });
  const textReplyId = await reply(rootId, 'Done, the report has its new name now.');
  const fileReplyId = await reply(fileId, 'Thanks, I am opening the report now.');
  // The reader takes part in the thread, so Activity and the Threads list show it; the file is
  // its newest reply.
  await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Can you attach the renamed report here as well?',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    ...fileContent(FILE_NAME, fileUrl),
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  return { reader, member, roomId, fileUrl, rootId, fileId, textReplyId, fileReplyId };
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The scope shows `shown` and holds no control character. */
const expectShown = async (scope: Locator, shown: string) => {
  await expect(scope).toContainText(shown, { timeout: 30_000 });
  expect(await scope.textContent()).not.toMatch(CONTROL);
};

/** Moves within the app, as a link would. */
const go = (page: Page, route: string) =>
  page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);

type ShownNotification = { title: string; body?: string };

/** The browser's Notification API as a recorder, permission granted. */
const recordNotifications = (page: Page) =>
  page.addInitScript(() => {
    const shown: { title: string; body?: string }[] = [];
    (window as unknown as { shownNotifications: typeof shown }).shownNotifications = shown;
    class RecordingNotification {
      static permission = 'granted';

      static requestPermission = async () => 'granted';

      onclick: (() => void) | null = null;

      constructor(title: string, options: NotificationOptions = {}) {
        shown.push({ title, body: options.body });
      }

      close() {
        return undefined;
      }
    }
    Object.defineProperty(window, 'Notification', { value: RecordingNotification });
  });

const shownNotifications = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { shownNotifications: ShownNotification[] }).shownNotifications
  );

const messageRow = (page: Page, eventId: string): Locator =>
  page.locator(`[data-message-id="${eventId}"]`).first();

/** Opens a message's menu at `word` of its row and starts a reply to it. */
const replyTo = async (page: Page, row: Locator, word: string, phone: boolean) => {
  await openMessageMenu(page, row, word, phone);
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click({ timeout: 30_000 });
};

const check = async (page: Page, world: World, label: string) => {
  const { member, roomId, rootId, fileId, textReplyId, fileReplyId } = world;
  const main = page.locator('main');

  // The room list.
  if (label.endsWith('phone')) await go(page, '/home/');
  const listed = page.getByRole('link').filter({ hasText: /^Payroll / });
  await expect(listed.first()).toBeAttached({ timeout: 60_000 });
  await listed.first().scrollIntoViewIfNeeded();
  await expectShown(listed.first(), ROOM_NAME_SHOWN);
  await shot(page, `${label}-room-list`);

  // System notifications of new messages in the room, which the reader has not opened.
  const liveText = `(${label}) Move the backup to archive‮piz.exe‬ tonight.`;
  const liveTextShown = `(${label}) Move the backup to archive<U+202E>piz.exe<U+202C> tonight.`;
  const liveFile = `${label}-summary‮fdp.exe`;
  const liveFileShown = `${label}-summary<U+202E>fdp.exe`;
  await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: liveText,
  });
  await sendRoomMessage(
    HOMESERVER,
    member.accessToken,
    roomId,
    fileContent(liveFile, world.fileUrl)
  );
  const about = (part: string) => async () =>
    (await shownNotifications(page)).find((note) => note.body?.includes(part));
  await expect.poll(about(`(${label}) Move`), { timeout: 30_000 }).toBeTruthy();
  await expect.poll(about(`${label}-summary`), { timeout: 30_000 }).toBeTruthy();
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(
      `${SHOTS}/${label}-system-notifications.json`,
      `${JSON.stringify(await shownNotifications(page), null, 2)}\n`
    );
  }
  expect(await about(`(${label}) Move`)()).toEqual({
    title: ROOM_NAME_SHOWN,
    body: `${MEMBER_NAME}: ${liveTextShown}`,
  });
  expect(await about(`${label}-summary`)()).toEqual({
    title: ROOM_NAME_SHOWN,
    body: `${MEMBER_NAME}: ${liveFileShown}`,
  });

  // Activity: the thread's row, with its title (the message) and its room's name.
  await go(page, '/activity/');
  const activityRow = page
    .locator('[data-activity-list="page"] [data-activity-row]')
    .filter({ hasText: 'auditors' });
  await expect(activityRow).toBeVisible({ timeout: 60_000 });
  await expectShown(activityRow, PLAIN_SHOWN);
  await expectShown(activityRow, ROOM_NAME_SHOWN);
  await shot(page, `${label}-activity`);

  // The room in its Threads view: the quotes above the reader's replies.
  await seedRoomOverviewState({
    page,
    roomId,
    userId: world.reader.userId,
    viewMode: 'threaded',
    filterState: createDefaultThreadFilterState(),
  });
  await go(page, `/home/${encodeURIComponent(roomId)}/`);
  const quoteOf = (replyId: string, quotedId: string) =>
    messageRow(page, replyId).locator(`[data-event-id="${quotedId}"]:not([data-thread-root-id])`);
  await expect(messageRow(page, fileReplyId)).toBeVisible({ timeout: 60_000 });
  await expectShown(quoteOf(textReplyId, rootId), PLAIN_SHOWN);
  await expectShown(quoteOf(fileReplyId, fileId), FILE_NAME_SHOWN);
  await quoteOf(fileReplyId, fileId).scrollIntoViewIfNeeded();
  await shot(page, `${label}-reply-quotes`);

  // The composer's reply bar, for the message and for the file.
  const replyBar = page.getByRole('button', { name: 'Cancel reply' }).locator('xpath=..');
  const phone = label.endsWith('phone');
  await replyTo(page, messageRow(page, rootId), 'Rename', phone);
  await expectShown(replyBar, PLAIN_SHOWN);
  await shot(page, `${label}-composer-reply-message`);
  await page.getByRole('button', { name: 'Cancel reply' }).click();
  await expect(replyBar).toBeHidden();
  await replyTo(page, messageRow(page, fileId), 'quarterly', phone);
  await expectShown(replyBar, FILE_NAME_SHOWN);
  await shot(page, `${label}-composer-reply-file`);
  await page.getByRole('button', { name: 'Cancel reply' }).click();
  await expect(replyBar).toBeHidden();

  // The Threads list: the thread's title (the message), its newest reply (a file, by its kind)
  // and its room.
  await go(page, '/threads/');
  const threadsRow = page
    .getByRole('navigation', { name: 'Threads' })
    .getByRole('button')
    .filter({ hasText: 'auditors' });
  await expect(threadsRow).toBeVisible({ timeout: 60_000 });
  await expectShown(threadsRow, PLAIN_SHOWN);
  await expectShown(threadsRow, `${MEMBER_NAME}: File`);
  await expectShown(threadsRow, ROOM_NAME_SHOWN);
  await shot(page, `${label}-threads-list`);

  // The room in its Compact view: the thread's card and the file's card.
  await seedRoomOverviewState({
    page,
    roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const card = (eventId: string) => main.locator(`button[data-thread-root-id="${eventId}"]`);
  await expect(card(rootId)).toBeVisible({ timeout: 60_000 });
  await expectShown(card(rootId), PLAIN_SHOWN);
  await expectShown(card(rootId), `${MEMBER_NAME}: ${FILE_NAME_SHOWN}`);
  await card(fileId).scrollIntoViewIfNeeded();
  await expectShown(card(fileId), FILE_NAME_SHOWN);
  await card(rootId).scrollIntoViewIfNeeded();
  await shot(page, `${label}-compact`);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    const context = await browser.newContext({ ...options, baseURL });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await recordNotifications(page);
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      await check(page, world, `${engine}-${viewport}`);
      expect(pageErrors, `uncaught errors in ${engine} ${viewport}`).toEqual([]);
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('previews show direction controls as code points (Chromium)', async ({ browser, baseURL }) => {
  test.setTimeout(420_000);
  await run(browser, baseURL, 'chromium');
});

test('previews show direction controls as code points (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(420_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
