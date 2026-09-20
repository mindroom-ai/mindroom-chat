import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, MatrixEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import {
  clearRoomCachedContent,
  resetCacheStoreForTesting,
  loadCachedAttachment,
} from '../threads/cacheStore';
import {
  hydrateCachedMindroomLongText,
  clearAttachmentRepositoryMemory,
  prefetchEventAttachments,
} from './attachmentRepository';
import { clearMindroomLongTextHydrationCache, getCachedMindroomLongTextContent } from './longText';
import { clearMindroomInMemoryCaches } from '../cache/sessionCleanup';

const baseUrl = 'https://matrix.example.org';
const roomId = '!test:matrix.example.org';
const userId = '@alice:matrix.example.org';
const sessionId = createSessionId(baseUrl, userId);
const source = {
  mxcUri: 'mxc://matrix.example.org/body',
  isV2ContentJson: true,
  previewContent: { msgtype: 'm.text', body: 'preview' },
  owner: { roomId, eventId: '$body', revisionTs: 1 },
};
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  clearAttachmentRepositoryMemory();
  clearMindroomLongTextHydrationCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each(['room-clear', 'logout', 'unowned-logout'] as const)(
  'fences parsed-memory publication after %s',
  async (kind) => {
    const mx = createClient({ baseUrl, userId });
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          })
      )
    );
    const pending = hydrateCachedMindroomLongText(
      mx,
      kind === 'unowned-logout' ? { ...source, owner: undefined } : source,
      false
    );
    await vi.waitFor(() => expect(finish).toBeDefined());
    if (kind === 'room-clear') await clearRoomCachedContent(sessionId, roomId);
    else clearMindroomInMemoryCaches();
    finish(new Response(JSON.stringify({ msgtype: 'm.text', body: 'late body' })));
    expect(await pending).toEqual(source.previewContent);
    expect(await loadCachedAttachment(sessionId, source.mxcUri)).toBeUndefined();
    expect(getCachedMindroomLongTextContent(source, mx)).toBeUndefined();
  }
);
it('measures reference rows read for ordinary text batch', async () => {
  const mx = createClient({ baseUrl, userId });
  let rowsRead = 0;
  let roomReads = 0;
  const original = IDBIndex.prototype.getAll;
  vi.spyOn(IDBIndex.prototype, 'getAll').mockImplementation(function countReferenceReads(
    query,
    count
  ) {
    const request = original.call(this, query, count);
    if (this.objectStore.name === 'attachment_references') {
      if (query === roomId || query === undefined) roomReads += 1;
      request.addEventListener('success', () => {
        rowsRead += request.result.length;
      });
    }
    return request;
  });
  const events = Array.from(
    { length: 300 },
    (_, i) =>
      new MatrixEvent({
        room_id: roomId,
        event_id: `$plain${i}`,
        sender: userId,
        origin_server_ts: i + 1,
        type: 'm.room.message',
        content: { msgtype: 'm.text', body: 'ordinary text' },
      })
  );
  await prefetchEventAttachments(mx, events, false);

  expect(roomReads).toBe(0);
  expect(rowsRead).toBe(0);
  await prefetchEventAttachments(mx, events, false);
  expect(roomReads).toBe(0);
  expect(rowsRead).toBe(300);
});

it('retries failed capability lookup on a later explicit download', async () => {
  const { createRoomOfflineController } = await import('../engine/roomOffline');
  const { createBackfillScheduler } = await import('../engine/backfillScheduler');
  const { saveRoomEventsToCacheCommitted } = await import('../threads/cacheStore');
  const mx = createClient({ baseUrl, userId, accessToken: 'test-token' });
  const room = {
    roomId,
    findEventById: () => undefined,
    getThread: () => undefined,
    getLiveTimeline: () => ({ getEvents: () => [], getPaginationToken: () => null }),
    getLastActiveTimestamp: () => 0,
  };
  vi.spyOn(mx, 'getRoom').mockReturnValue(room as never);
  vi.spyOn(mx, 'getEventMapper').mockReturnValue(((raw: object) => new MatrixEvent(raw)) as never);
  vi.spyOn(mx, 'decryptEventIfNeeded').mockResolvedValue(undefined);
  vi.spyOn(mx, 'createMessagesRequest').mockResolvedValue({ chunk: [] } as never);
  const versions = vi
    .spyOn(mx, 'getVersions')
    .mockRejectedValueOnce(new TypeError('transient'))
    .mockResolvedValue({ versions: ['v1.11'] });
  const fetched: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url);
      return url.includes('/_matrix/client/v1/media/')
        ? new Response(JSON.stringify({ msgtype: 'm.text', body: 'restored body' }))
        : new Response('', { status: 403 });
    })
  );
  await saveRoomEventsToCacheCommitted(sessionId, roomId, [
    {
      event_id: '$body',
      room_id: roomId,
      sender: userId,
      origin_server_ts: 1,
      type: 'm.room.message',
      content: {
        msgtype: 'm.text',
        body: 'preview',
        url: source.mxcUri,
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      },
    },
  ]);
  const scheduler = createBackfillScheduler({ mx });
  const control = createRoomOfflineController({
    mx,
    sessionId,
    scheduler,
    connection: {
      getSnapshot: () => ({ connected: true, unmetered: true }),
      subscribe: () => () => {},
    },
    getPrefetchConfig: () => ({ scope: 'current-room-only' }),
    onChanged: () => {},
  });
  control.start();
  try {
    control.focus(roomId);
    await vi.waitFor(() => expect(control.controller.getSnapshot(roomId).status).toBe('ready'));
    expect(versions).toHaveBeenCalledTimes(1);
    expect(control.controller.getSnapshot(roomId).missingEssential).toBe(1);
    control.controller.download(roomId);
    await vi.waitFor(() => expect(fetched.length).toBeGreaterThan(1));
    await vi.waitFor(() => expect(control.controller.getSnapshot(roomId).downloading).toBe(false));
    expect(versions).toHaveBeenCalledTimes(2);
    expect(control.controller.getSnapshot(roomId).missingEssential).toBe(0);
  } finally {
    control.stop();
    scheduler.abortAll();
  }
});

it('keeps validated essential coverage when storage pressure denies a repeated prefetch', async () => {
  const {
    __setCacheStoreByteBudgetForTests,
    readRoomAttachmentStorage,
    runCacheEvictionIfOverBudget,
  } = await import('../threads/cacheStore');
  const mx = createClient({ baseUrl, userId });
  const body = new MatrixEvent({
    room_id: roomId,
    event_id: '$body',
    sender: userId,
    origin_server_ts: 1,
    type: 'm.room.message',
    content: {
      msgtype: 'm.text',
      body: 'preview',
      url: source.mxcUri,
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
    },
  });
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ msgtype: 'm.text', body: 'validated body' }))
  );
  vi.stubGlobal('fetch', fetch);
  expect(await prefetchEventAttachments(mx, [body], false)).toEqual({ saved: 1, missing: 0 });
  __setCacheStoreByteBudgetForTests(1);
  try {
    expect(
      await prefetchEventAttachments(mx, [body], false, {
        canDownload: async () => !(await runCacheEvictionIfOverBudget(sessionId)).underPressure,
      })
    ).toEqual({ saved: 1, missing: 0 });
    expect(await readRoomAttachmentStorage(sessionId, roomId)).toMatchObject({
      saved: 1,
      missingEssential: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    clearMindroomLongTextHydrationCache();
    expect(await hydrateCachedMindroomLongText(mx, source, false)).toMatchObject({
      body: 'validated body',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    __setCacheStoreByteBudgetForTests(undefined);
  }
});
