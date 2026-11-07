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
import { joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (P2-lane2-F001): rooms read on another device came back unread for a moment after a
// reload of this one, and for as long as the reload had no answer from the server: the title said
// "(6)" and the rows showed their old counts. A reload starts from the sync the client saved, and
// the client saved nothing when only the account's read receipts changed. The reader's desk opens
// with two unread rooms (three messages in one, a thread with two replies in the other); another
// device reads both; the desk reloads while its first sync from the server is held back. No
// sample of the title or the two rows, taken at every frame from the start of the page, may show
// them unread. Chromium on a desktop (1440 by 900, classic scrollbars) and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit on a phone (390 by 844, touch),
// against the disposable homeserver of a slot (scripts/e2e-slot.sh). Set RELOAD_READ_SHOTS to a
// directory to save the screen while the reload waits for the server.
const PASSWORD = 'reload-read-elsewhere-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.RELOAD_READ_SHOTS;
const FILLER_ROOMS = 25;
/** How long the reloaded page's syncs get no answer, as on a slow or absent network. */
const HELD_SYNC_MS = 4_000;
/**
 * The client saves a change other than a deletion at most this often (`CHANGE_SAVE_GAP_MS` in
 * src/app/matrix/client/savedSyncRedactions.ts, 10 s): the person comes back to the desk later.
 */
const BACK_AT_DESK_MS = 12_000;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 900 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
};

type World = {
  reader: DisposableUser;
  supportId: string;
  designId: string;
  newestSupportId: string;
  designRootId: string;
  newestDesignReplyId: string;
};

const seed = async (engine: string): Promise<World> => {
  const reader = await registerDisposableUser(`rre_${engine}_${RUN}`, PASSWORD);
  const writer = await registerDisposableUser(`rre_w_${engine}_${RUN}`, PASSWORD);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  const shared = async (name: string) => {
    const roomId = await createRoom(HOMESERVER, reader.accessToken, {
      name,
      invite: [writer.userId],
    });
    await joinRoom(HOMESERVER, writer.accessToken, roomId);
    return roomId;
  };
  const supportId = await shared('Support Room');
  const designId = await shared('Design Room');
  const send = (roomId: string, body: string, rootId?: string) =>
    sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
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
  await send(supportId, 'The export to CSV drops the last column when a cell holds a comma.');
  await send(supportId, 'It happens in both the web app and the desktop app, since Monday.');
  const newestSupportId = await send(
    supportId,
    'Could someone check whether the quoting change from last week caused it?'
  );
  const designRootId = await send(
    designId,
    'New icons for the settings page are ready for review.'
  );
  await send(designId, 'The gear icon looks heavier than the others at small sizes.', designRootId);
  const newestDesignReplyId = await send(
    designId,
    'I thinned its stroke to match; the updated file is in the shared folder.',
    designRootId
  );
  return { reader, supportId, designId, newestSupportId, designRootId, newestDesignReplyId };
};

/** The number on a room row's badge, or 0 without one. */
const rowCount = (page: Page, roomId: string): Promise<number> =>
  page.evaluate((id) => {
    const text = (document.querySelector(`[data-room-id="${id}"]`) as HTMLElement | null)
      ?.innerText;
    const match = /(\d+)\s*$/.exec(text?.trim() ?? '');
    return match ? Number(match[1]) : 0;
  }, roomId);

/** The unread count the client's saved sync holds for the room, or undefined without the room. */
const savedCount = (page: Page, roomId: string): Promise<number | undefined> =>
  page.evaluate(async (id) => {
    type Joined = { unread_notifications?: { notification_count?: number } };
    const names = (await indexedDB.databases())
      .map((database) => database.name ?? '')
      .filter((name) => name.startsWith('matrix-js-sdk:'));
    for (const name of names) {
      const count = await new Promise<number | undefined>((resolve) => {
        const open = indexedDB.open(name);
        open.onerror = () => resolve(undefined);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('sync')) {
            db.close();
            resolve(undefined);
            return;
          }
          const read = db.transaction('sync').objectStore('sync').getAll();
          read.onerror = () => resolve(undefined);
          read.onsuccess = () => {
            db.close();
            const records = read.result as { roomsData?: { join?: Record<string, Joined> } }[];
            const room = records.find((record) => record.roomsData?.join?.[id])?.roomsData?.join?.[
              id
            ];
            resolve(room ? room.unread_notifications?.notification_count ?? 0 : undefined);
          };
        };
      });
      if (count !== undefined) return count;
    }
    return undefined;
  }, roomId);

/** A read receipt of the reader's, sent as another of their devices would. */
const readElsewhere = (world: World, roomId: string, eventId: string, threadId?: string) =>
  matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
    {
      method: 'POST',
      accessToken: world.reader.accessToken,
      body: JSON.stringify(threadId ? { thread_id: threadId } : {}),
    }
  );

/**
 * From the start of each page load, records the title and the two rows' badge text at every
 * frame in which one of them changed.
 */
const sampleFromLoad = (page: Page, roomIds: string[]) =>
  page.addInitScript((ids) => {
    const samples: string[] = [];
    (window as unknown as { readSamples: string[] }).readSamples = samples;
    const take = () => {
      const rows = ids.map((id) => {
        const text = (document.querySelector(`[data-room-id="${id}"]`) as HTMLElement | null)
          ?.innerText;
        if (text === undefined) return 'absent';
        return /(\d+)\s*$/.exec(text.trim())?.[1] ?? '0';
      });
      const sample = `${document.title} | ${rows.join(' ')}`;
      if (samples.at(-1) !== sample) samples.push(sample);
      requestAnimationFrame(take);
    };
    requestAnimationFrame(take);
  }, roomIds);

const check = async (
  browser: Browser,
  baseURL: string | undefined,
  engine: string,
  options: BrowserContextOptions
) => {
  const world = await seed(engine);
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...world.reader });
    // The session's first sync, saved by the client, counts the unread messages.
    await expect.poll(() => rowCount(page, world.supportId), { timeout: 60_000 }).toBe(3);
    await expect.poll(() => rowCount(page, world.designId), { timeout: 60_000 }).toBe(3);
    await expect.poll(() => savedCount(page, world.supportId), { timeout: 30_000 }).toBe(3);

    // Another device reads both rooms: the thread up to its newest reply, and the main timeline.
    await readElsewhere(world, world.supportId, world.newestSupportId);
    await readElsewhere(world, world.designId, world.newestDesignReplyId, world.designRootId);
    await readElsewhere(world, world.designId, world.designRootId, 'main');
    await expect.poll(() => rowCount(page, world.supportId), { timeout: 30_000 }).toBe(0);
    await expect.poll(() => rowCount(page, world.designId), { timeout: 30_000 }).toBe(0);
    await expect.poll(() => page.title(), { timeout: 30_000 }).not.toMatch(/^\(/);
    await page.waitForTimeout(BACK_AT_DESK_MS);

    // The desk reloads; the server answers its syncs only after a while.
    let holdUntil = 0;
    await page.route(/\/_matrix\/client\/v3\/sync\?/, async (route) => {
      const wait = holdUntil - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      await route.continue().catch(() => undefined);
    });
    await sampleFromLoad(page, [world.supportId, world.designId]);
    holdUntil = Date.now() + HELD_SYNC_MS;
    await page.reload();
    await expect(page.locator(`[data-room-id="${world.supportId}"]`).first()).toBeVisible({
      timeout: 30_000,
    });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/reload-${engine}.png` });
    await page.waitForTimeout(Math.max(0, holdUntil - Date.now()) + 2_000);

    const samples = await page.evaluate(
      () => (window as unknown as { readSamples: string[] }).readSamples
    );
    const unread = samples.filter((sample) => /^\(|\| .*[1-9]/.test(sample));
    expect(unread, `samples after the reload: ${samples.join(' / ')}`).toEqual([]);
    expect(
      samples.some((sample) => !sample.includes('absent')),
      samples.join(' / ')
    ).toBe(true);
  } finally {
    await context.close();
  }
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('rooms read on another device stay read through a reload', async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await check(browser, baseURL, 'chromium', DESKTOP);
});

test('rooms read on another device stay read through a reload (WebKit, phone)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    await check(browser, baseURL, 'webkit', PHONE);
  } finally {
    await browser.close();
  }
});
