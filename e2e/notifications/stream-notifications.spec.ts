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
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A MindRoom agent streams a reply as one message: a placeholder sent as an `m.text` marked
// `io.mindroom.stream_status: pending`, `m.replace` edits marked `streaming`, and a last edit
// marked `completed` with the finished text. A reader looking at another room gets one desktop
// notification per reply, with the finished text, and none for the placeholder or the progress
// edits. Both a thread reply and a main-timeline reply (a room in `thread_mode: room`) are
// checked. Against the disposable homeserver of a slot (scripts/e2e-slot.sh), on a desktop
// (1280 by 800), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in
// WebKit. Set STREAM_NOTIFICATION_SHOTS=<directory> to save the screen once the replies finished.
const PASSWORD = 'stream-notifications-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.STREAM_NOTIFICATION_SHOTS;
const ROOM_NAME = 'Release Desk';
const QUIET_NAME = 'Quiet Corner';
const FILLER_ROOMS = 24;
const HISTORY = 20;
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const PLACEHOLDER = 'Thinking...';
const FIRST_STEP = 'Checking the release notes against the merged changes.';
const finished = (label: string) =>
  `Ready for ${label}: the notes list the export fix and the keyboard shortcuts, and the migration note moved to the top.`;

type ShownNotification = { title: string; body?: string; tag?: string };
type Account = MatrixSession & { username: string };
type World = { reader: Account; agent: MatrixSession; roomId: string; quietId: string };

const seed = async (engine: string): Promise<World> => {
  const reader = await registerDisposableUser(`sn_${engine}_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `notes_${engine}`);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
    method: 'PUT',
    accessToken: agent.accessToken,
    body: JSON.stringify({ displayname: 'Helper' }),
  });
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const quietId = await createRoom(HOMESERVER, reader.accessToken, {
    name: QUIET_NAME,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, quietId);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromAgent = index % 2 === 0;
    await sendRoomMessage(HOMESERVER, (fromAgent ? agent : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromAgent
        ? `Release item ${index}: the build passed, the changelog is drafted, and the staging deploy is waiting for the last review.`
        : `Release item ${index}: what is still open before we tag?`,
      ...(fromAgent ? { 'io.mindroom.stream_status': 'completed' } : {}),
    });
  }
  return { reader, agent, roomId, quietId };
};

const inThread = (rootId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

type SyncWatch = { delivered: (eventId: string) => Promise<void> };

/** Remembers the event IDs of the page's /sync answers, so a step waits until the page has it. */
const watchSync = (page: Page): SyncWatch => {
  const seen = new Set<string>();
  page.on('response', (response) => {
    if (!new URL(response.url()).pathname.endsWith('/_matrix/client/v3/sync')) return;
    response.text().then(
      (text) => {
        for (const [, id] of text.matchAll(/"event_id":"(\$[^"]+)"/g)) if (id) seen.add(id);
      },
      () => undefined
    );
  });
  return {
    delivered: (eventId) => expect.poll(() => seen.has(eventId), { timeout: 30_000 }).toBe(true),
  };
};

/**
 * Sends one step of a reply and waits until the page's sync brought it: MindRoom's steps are
 * seconds apart, so the client hears of the placeholder before any edit of it.
 */
const sendStep = async (sync: SyncWatch, world: World, content: Record<string, unknown>) => {
  const eventId = await sendRoomMessage(HOMESERVER, world.agent.accessToken, world.roomId, content);
  await sync.delivered(eventId);
  return eventId;
};

/** The edit MindRoom sends while a reply streams (an `m.notice`) or once it finished. */
const streamEdit = (
  sync: SyncWatch,
  world: World,
  replyId: string,
  body: string,
  status: string
) => {
  const msgtype = status === 'completed' ? 'm.text' : 'm.notice';
  return sendStep(sync, world, {
    msgtype,
    body: `* ${body}`,
    'io.mindroom.stream_status': status,
    'm.new_content': { msgtype, body, 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
  });
};

/**
 * A reply streamed as MindRoom does: in a thread, or in the main timeline as an answer to the
 * question (`thread_mode: room`).
 */
const streamReply = async (
  sync: SyncWatch,
  world: World,
  label: string,
  relation: Record<string, unknown>
) => {
  const replyId = await sendStep(sync, world, {
    msgtype: 'm.text',
    body: PLACEHOLDER,
    'io.mindroom.stream_status': 'pending',
    ...relation,
  });
  await streamEdit(sync, world, replyId, FIRST_STEP, 'streaming');
  await streamEdit(sync, world, replyId, finished(label), 'completed');
};

/**
 * The browser's Notification API as a recorder: permission granted, every notification kept on
 * `window.shownNotifications`.
 */
const recordNotifications = (page: Page) =>
  page.addInitScript(() => {
    const shown: { title: string; body?: string; tag?: string }[] = [];
    (window as unknown as { shownNotifications: typeof shown }).shownNotifications = shown;
    class RecordingNotification {
      static permission = 'granted';

      static requestPermission = async () => 'granted';

      onclick: (() => void) | null = null;

      constructor(title: string, options: NotificationOptions = {}) {
        shown.push({ title, body: options.body, tag: options.tag });
      }

      close() {
        return undefined;
      }
    }
    Object.defineProperty(window, 'Notification', { value: RecordingNotification });
  });

/** The notifications shown so far, by body: thread and room events may arrive in either order. */
const shownNotifications = async (page: Page) =>
  (
    await page.evaluate(() => [
      ...(window as unknown as { shownNotifications: ShownNotification[] }).shownNotifications,
    ])
  ).sort((a, b) => (a.body ?? '').localeCompare(b.body ?? ''));

const check = async (page: Page, world: World, label: string) => {
  await recordNotifications(page);
  const sync = watchSync(page);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.reader.username,
    password: PASSWORD,
  });
  await page.getByRole('link', { name: new RegExp(QUIET_NAME) }).click();
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(world.quietId)));
  await expect(page.getByRole('heading', { name: QUIET_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });

  const ask = (question: string) =>
    sendRoomMessage(HOMESERVER, world.reader.accessToken, world.roomId, {
      msgtype: 'm.text',
      body: question,
    });
  const rootId = await ask(`Which ${label} fixes go into the notes?`);
  await streamReply(sync, world, `${label} thread`, inThread(rootId));
  const questionId = await ask(`Is the ${label} changelog drafted?`);
  await streamReply(sync, world, `${label} room`, {
    'm.relates_to': { 'io.mindroom.in_reply_to': { event_id: questionId } },
  });
  // A later message: once it notified, the client had every edit sent before it.
  await sendRoomMessage(HOMESERVER, world.agent.accessToken, world.roomId, {
    msgtype: 'm.text',
    body: `The ${label} tag is pushed.`,
  });

  const expected = [
    `Helper: ${finished(`${label} room`)}`,
    `Helper: ${finished(`${label} thread`)}`,
    `Helper: The ${label} tag is pushed.`,
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((body) => ({ title: ROOM_NAME, body, tag: world.roomId }));
  await expect
    .poll(async () => (await shownNotifications(page)).length, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(expected.length);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replaceAll(' ', '-')}.png` });
  expect(await shownNotifications(page)).toEqual(expected);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  // WebKit sends a service worker's requests past the page's response events.
  const context = await browser.newContext({ ...DESKTOP, baseURL, serviceWorkers: 'block' });
  try {
    await check(await context.newPage(), world, engine);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a streamed agent reply notifies once, with its finished text (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await run(browser, baseURL, 'chromium');
});

test('a streamed agent reply notifies once, with its finished text (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
