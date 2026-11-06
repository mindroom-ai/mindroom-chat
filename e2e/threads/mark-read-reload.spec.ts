import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { onWebKitPage } from '../helpers/webkit';

// Mark as Read sends one unthreaded receipt, which reads the room and every thread up to the
// newest event. Here that event is a reply the reader had read on their phone, so they hold a
// thread receipt on the same event. Their threads stay read on the desk through reloads, as on
// the server: the second reload replays the receipts the first one saved. Runs in Chromium and,
// when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh).
const PASSWORD = 'mark-read-reload-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.THREAD_READ_RELOAD_SHOTS;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const THREADS = [
  [
    'Vendor contract renewal for the Berlin office',
    'The renewal draft is in the shared folder. Legal wants the termination clause reworded before Friday, and procurement asks whether we keep the three-year term.',
  ],
  [
    'Staging database migration window',
    'Thursday 22:00 to 23:30 works for the platform team. The rollback plan is the snapshot from 21:45, and support will post the notice in the status channel.',
  ],
  [
    'Quarterly planning: hiring and budget',
    'Finance approved two of the three requested roles. The design role moves to next quarter unless we find savings in the tooling budget.',
  ],
] as const;

/** The newest `sync` record the SDK saved, as the next start replays it. */
const savedSyncBatch = (page: Page): Promise<string | null> =>
  page.evaluate(async () => {
    const names = (await indexedDB.databases())
      .map((database) => database.name ?? '')
      .filter((name) => name.startsWith('matrix-js-sdk:web-sync-store'));
    const batches = await Promise.all(
      names.map(
        (name) =>
          new Promise<string | null>((resolve) => {
            const open = indexedDB.open(name);
            open.onerror = () => resolve(null);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains('sync')) {
                db.close();
                resolve(null);
                return;
              }
              const read = db.transaction('sync').objectStore('sync').getAll();
              read.onerror = () => resolve(null);
              read.onsuccess = () => {
                db.close();
                const records = read.result as Array<{ nextBatch?: string }>;
                resolve(records[0]?.nextBatch ?? null);
              };
            };
          })
      )
    );
    return batches.find((batch) => batch !== null) ?? null;
  });

type RoomCounts = { total: number; threads: number };

/** The reader's notification counts for the room on the server. */
const serverCounts = async (reader: DisposableUser, roomId: string): Promise<RoomCounts> => {
  const filter = JSON.stringify({ room: { rooms: [roomId], timeline: { limit: 1 } } });
  const sync = await matrixFetch<{
    rooms?: {
      join?: Record<
        string,
        {
          unread_notifications?: { notification_count?: number };
          unread_thread_notifications?: Record<string, { notification_count?: number }>;
        }
      >;
    };
  }>(HOMESERVER, `/sync?timeout=0&filter=${encodeURIComponent(filter)}`, {
    accessToken: reader.accessToken,
  });
  const room = sync.rooms?.join?.[roomId];
  const threads = Object.values(room?.unread_thread_notifications ?? {}).filter(
    (counts) => (counts.notification_count ?? 0) > 0
  ).length;
  return { total: room?.unread_notifications?.notification_count ?? 0, threads };
};

const threadsStayReadThroughReloads = async (page: Page, browserName: string) => {
  const reader = await registerDisposableUser(`mrr_reader_${browserName}_${RUN}`, PASSWORD);
  const colleague = await registerDisposableUser(`mrr_colleague_${browserName}_${RUN}`, PASSWORD);
  const roomName = `Operations ${browserName} ${RUN}`;
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    invite: [colleague.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  const rootIds: string[] = [];
  let newestReply = '';
  for (const [title, reply] of THREADS) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
      msgtype: 'm.text',
      body: title,
    });
    rootIds.push(rootId);
    // eslint-disable-next-line no-await-in-loop
    newestReply = await sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
      msgtype: 'm.text',
      body: reply,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }
  const lastRoot = rootIds[rootIds.length - 1];
  // The reader's phone read the newest thread: a thread receipt on its reply, the newest event.
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(newestReply)}`,
    {
      method: 'POST',
      accessToken: reader.accessToken,
      body: JSON.stringify({ thread_id: lastRoot }),
    }
  );

  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  const roomLink = page.getByRole('link', { name: roomName }).first();
  await roomLink.click();
  const unreadCards = page.locator(
    rootIds.map((id) => `[data-thread-root-id="${id}"][data-thread-unread="true"]`).join(', ')
  );
  await expect(page.locator(`[data-thread-root-id="${rootIds[0]}"]`)).toBeVisible({
    timeout: 60_000,
  });
  // Every root is unread in the room's main timeline, which the phone's thread receipt leaves.
  await expect(unreadCards).toHaveCount(3);

  const markedRead = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().includes(`/receipt/m.read/${encodeURIComponent(newestReply)}`) &&
      request.postDataJSON()?.thread_id === undefined
  );
  await roomLink.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mark as Read', exact: true }).click();
  await markedRead;
  await expect(unreadCards).toHaveCount(0);
  await expect
    .poll(() => serverCounts(reader, roomId), { timeout: 15_000 })
    .toEqual({
      total: 0,
      threads: 0,
    });

  // The first start after a reload saves what it synced; the second replays that save.
  const batchBefore = await savedSyncBatch(page);
  await page.reload();
  await expect(page.locator(`[data-thread-root-id="${rootIds[0]}"]`)).toBeVisible({
    timeout: 60_000,
  });
  await expect.poll(() => savedSyncBatch(page), { timeout: 30_000 }).not.toBe(batchBefore);
  await expect(unreadCards).toHaveCount(0);

  await page.reload();
  await expect(page.locator(`[data-thread-root-id="${rootIds[0]}"]`)).toBeVisible({
    timeout: 60_000,
  });
  // Long enough for a sync to correct the view, which must not need one.
  await page.waitForTimeout(3_000);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mark-read-reload-${browserName}.png` });
  await expect(unreadCards, 'thread cards after the second reload').toHaveCount(0);
  expect(await serverCounts(reader, roomId)).toEqual({ total: 0, threads: 0 });
};

test('threads read by Mark as Read stay read through reloads (Chromium)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(300_000);
  await threadsStayReadThroughReloads(page, browserName);
});

test('threads read by Mark as Read stay read through reloads (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    threadsStayReadThroughReloads(page, 'webkit')
  );
});
