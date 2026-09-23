import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { readSessionStore } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

test.use({ serviceWorkers: 'block' });

test('repairs a legacy cached summary for the overview and thread banner while Matrix is unavailable', async ({
  page,
}) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Summary recovery ${Date.now()}`,
  });
  const rootId = await sendRoomMessage(
    homeserver,
    session.accessToken,
    roomId,
    { msgtype: 'm.text', body: 'Original prompt' },
    'summary-recovery'
  );
  await sendRoomMessage(
    homeserver,
    session.accessToken,
    roomId,
    {
      msgtype: 'm.text',
      body: 'Latest server reply',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    },
    'summary-recovery'
  );
  await loginWithPassword(page, { homeserver, ...credentials });
  await seedRoomOverviewState({ page, roomId, userId: session.userId, viewMode: 'compact' });
  const roomPath = `/home/${encodeURIComponent(roomId)}`;
  await page.goto(roomPath);
  const card = page.locator(`[data-compact-room-view] [data-thread-root-id="${rootId}"]`);
  await expect(card).toBeVisible();
  const { activeSessionId } = await readSessionStore(page);
  expect(activeSessionId).toBeTruthy();
  const filter = encodeURIComponent(
    JSON.stringify({ room: { rooms: [roomId], timeline: { limit: 1 } } })
  );
  const savedSync = await matrixFetch<{ next_batch: string; rooms: unknown }>(
    homeserver,
    `/sync?timeout=0&filter=${filter}`,
    { accessToken: session.accessToken }
  );
  const summaryText = 'Recovered summary from older downloaded history';

  // Stop the client, then seed the old cache format: summary notices are present,
  // but the derived summary and repair marker are absent.
  await page.goto('/config.json');
  await page.evaluate(
    async ({ sessionId, room, root, sync, title }) => {
      const open = (name: string) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const cache = await open(`mindroom-cache::${sessionId}`);
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = cache.transaction(
            ['events', 'meta', 'thread_summaries'],
            'readwrite'
          );
          const events = transaction.objectStore('events');
          const now = Date.now();
          for (let index = 0; index <= 96; index += 1) {
            const id = `$cached-${index}`;
            const ts = now + index;
            const rawEvent = {
              event_id: id,
              room_id: room,
              origin_server_ts: ts,
              type: 'm.room.message',
              sender: '@fixture:example.org',
              content: {
                msgtype: index === 0 ? 'm.notice' : 'm.text',
                body: index === 0 ? title : `Downloaded reply ${index}`,
                ...(index === 0 ? { 'io.mindroom.thread_summary': true } : {}),
                'm.relates_to': { rel_type: 'm.thread', event_id: root },
              },
            };
            events.put({
              cacheKey: `${room}|${root}|${id}`,
              roomId: room,
              scope: root,
              eventId: id,
              ts,
              rawEvent,
              approxBytes: JSON.stringify(rawEvent).length,
            });
          }
          const meta = transaction.objectStore('meta');
          meta.delete(`${room}|__summaryRepair`);
          const request = meta.get(`${room}|${root}`);
          request.onsuccess = () =>
            meta.put({
              ...request.result,
              metaKey: `${room}|${root}`,
              roomId: room,
              scope: root,
              expectedReplyCount: 97,
              updatedAt: now,
            });
          transaction.objectStore('thread_summaries').delete(`${room}|${root}`);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        cache.close();
      }
      const sdk = await open(`matrix-js-sdk:web-sync-store::${sessionId}`);
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = sdk.transaction('sync', 'readwrite');
          transaction
            .objectStore('sync')
            .put({ clobber: '-', nextBatch: sync.next_batch, roomsData: sync.rooms });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        sdk.close();
      }
    },
    { sessionId: activeSessionId!, room: roomId, root: rootId, sync: savedSync, title: summaryText }
  );

  await page.route(/\/_matrix\//, (route) => route.abort('internetdisconnected'));
  await page.goto(roomPath);
  await expect(card).toContainText(summaryText, { timeout: 15_000 });
  await card.click();
  await expect(page.locator('[data-thread-context-summary="true"]').first()).toContainText(
    summaryText
  );
  await page.goBack();
  await expect(card).toContainText(summaryText);
  await page.reload();
  await expect(card).toContainText(summaryText);
});
