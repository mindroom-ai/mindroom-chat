import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createHiddenOverviewFilterState,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendMessageEdit,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// A reader on a slow device watches a room whose 20 thread replies are each edited 20 times in
// about 26 seconds (400 edits). Once the burst is over, every card previews its reply's last
// edit. Slow clients kept the edit before it on a part of the cards, for minutes, until the
// thread was opened (live-test pass 2, load lane, P2-lane6-F002).
// Against the disposable homeserver of a slot: Chromium on a desktop with its CPU slowed four
// times, and (with PLAYWRIGHT_WEBKIT_EXECUTABLE) WebKit on a 390 by 844 touch phone.
const PASSWORD = 'card-preview-edit-burst-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = 'Release Board';
const FILLER_ROOMS = 25;
const THREADS = 20;
const REVISIONS = 20;
/** About how long the 400 edits take, as in the load lane's run. */
const BURST_MS = 26_000;

const replyText = (index: number, revision: number) =>
  `Edit burst reply ${index} rev ${revision}${revision === REVISIONS ? ' FINAL' : ''}`;

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `ceb_${name}_${RUN}`;
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

/** Runs `count` jobs, `width` at a time. */
const inBatches = async (
  count: number,
  width: number,
  job: (index: number) => Promise<unknown>
) => {
  for (let start = 0; start < count; start += width)
    await Promise.all(
      Array.from({ length: Math.min(width, count - start) }, (_, offset) => job(start + offset))
    );
};

type World = {
  reader: Account;
  writer: Account;
  roomId: string;
  threads: { index: number; rootId: string; replyId: string }[];
};

const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(engine);
  const asker = await registerAndLogin(`${engine}_asker`);
  const writer = await registerAndLogin(`${engine}_writer`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [asker.userId, writer.userId],
  });
  await joinRoom(HOMESERVER, asker.accessToken, roomId);
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  await inBatches(FILLER_ROOMS, 5, (index) =>
    createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
  );
  const threads: World['threads'] = [];
  await inBatches(THREADS, 5, async (offset) => {
    const index = offset + 1;
    const rootId = await sendRoomMessage(HOMESERVER, asker.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Release item ${index}: what does the changelog still need?`,
    });
    const replyId = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: replyText(index, 0),
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    threads.push({ index, rootId, replyId });
  });
  threads.sort((a, b) => a.index - b.index);
  return { reader, writer, roomId, threads };
};

const threadCard = (page: Page, rootId: string) =>
  page.locator(`[data-compact-room-view] [data-thread-root-id="${rootId}"]`).first();

const check = async (page: Page, world: World, engine: string) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createHiddenOverviewFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(world.roomId)}/`);
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });
  for (const thread of world.threads)
    await expect(threadCard(page, thread.rootId)).toContainText(replyText(thread.index, 0), {
      timeout: 60_000,
    });

  // 20 edits of each reply, one round of 20 edits about every 1.3 seconds.
  const started = Date.now();
  for (let revision = 1; revision <= REVISIONS; revision += 1) {
    await inBatches(world.threads.length, 10, async (offset) => {
      const thread = world.threads[offset];
      if (!thread) return;
      await sendMessageEdit(
        HOMESERVER,
        world.writer.accessToken,
        world.roomId,
        thread.replyId,
        replyText(thread.index, revision)
      );
    });
    const due = started + (BURST_MS * revision) / REVISIONS - Date.now();
    if (due > 0) await page.waitForTimeout(due);
  }

  // The load lane read the cards 2, 10, 30 and 60 seconds after the burst; stale ones stayed.
  const readStale = () =>
    page.evaluate(
      ({ threads, finals }) =>
        threads.flatMap(({ index, rootId }, position) => {
          const text =
            document.querySelector(
              `[data-compact-room-view] [data-thread-root-id="${CSS.escape(rootId)}"]`
            )?.textContent ?? '';
          const final = finals[position] ?? '';
          return text.includes(final) ? [] : [`${index}: ${text.slice(-90)}`];
        }),
      {
        threads: world.threads.map(({ index, rootId }) => ({ index, rootId })),
        finals: world.threads.map((thread) => replyText(thread.index, REVISIONS)),
      }
    );
  let stale = await readStale();
  for (let waited = 0; stale.length > 0 && waited < 15_000; waited += 500) {
    await page.waitForTimeout(500);
    stale = await readStale();
  }
  // eslint-disable-next-line no-console
  console.log(`card preview edit burst: ${engine}: ${stale.length} stale of ${THREADS}`);
  expect(stale, `${engine}: cards without the last edit 15 s after the burst`).toEqual([]);
};

const run = async (
  newContext: () => Promise<BrowserContext>,
  engine: string,
  throttle?: number
) => {
  const world = await seed(engine);
  const context = await newContext();
  try {
    const page = await context.newPage();
    if (throttle) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    }
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await check(page, world, engine);
  } finally {
    await context.close();
  }
};

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('every card previews its reply’s last edit after an edit burst (Chromium, CPU 4x slower)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await run(
    () => browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL }),
    'chromium',
    4
  );
});

test('every card previews its reply’s last edit after an edit burst (WebKit phone)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(
      () =>
        browser.newContext({
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 3,
          hasTouch: true,
          baseURL,
        }),
      'webkit'
    );
  } finally {
    await browser.close();
  }
});
