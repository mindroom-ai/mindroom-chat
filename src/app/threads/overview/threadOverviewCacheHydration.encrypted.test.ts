import { describe, expect, it } from 'vitest';
import { MatrixEvent, type IEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { CachedThreadEventPage } from '../../event-store/cache/db/cacheStoreEvents';
import {
  mapCachedPagesForOverview,
  resolveCachedOverviewUpdate,
} from './threadOverviewCacheHydration';

// Regression (P3-webkit-cards-F010): after a reload, the cards of an encrypted room's older threads
// previewed the person's question instead of the helper's reply. The server bundles no previews for
// encrypted rooms and the thread's summary names its title notice, so the card knows the reply only
// from the thread's events: the cached copies, which are ciphertext and decrypted after the pass
// had read them.

const ROOM = '!secure:example.org';
const ROOT = '$question';
const HELPER = '@mindroom_helper:example.org';

const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: ROOT } };

const encrypted = (eventId: string, ts: number): IEvent =>
  ({
    type: 'm.room.encrypted',
    event_id: eventId,
    room_id: ROOM,
    sender: HELPER,
    origin_server_ts: ts,
    unsigned: {},
    content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: eventId, ...inThread },
  } as IEvent);

/** What each cached event decrypts to: the helper's reply, then its title notice. */
const clear: Record<string, { type: string; content: Record<string, unknown> }> = {
  $reply: {
    type: 'm.room.message',
    content: { msgtype: 'm.text', body: 'word1 word2', ...inThread },
  },
  $title: {
    type: 'm.room.message',
    content: {
      msgtype: 'm.notice',
      body: 'Release notes',
      'io.mindroom.thread_summary': { version: 1, summary: 'Release notes' },
      ...inThread,
    },
  },
};

const page: CachedThreadEventPage = {
  events: [encrypted('$reply', 2), encrypted('$title', 3)],
  hasMoreBefore: false,
};

const room = {
  roomId: ROOM,
  hasEncryptionStateEvent: () => true,
  findEventById: () => undefined,
  getThread: () => null,
  getMember: () => null,
  getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
} as unknown as Room;

/** A client whose decryption, like the real one, finishes after the event was mapped. */
const client = () =>
  ({
    getEventMapper: () => (raw: IEvent) => new MatrixEvent(raw),
    decryptEventIfNeeded: async (event: MatrixEvent) => {
      await Promise.resolve();
      Object.assign(event, { clearEvent: clear[event.getId() ?? ''] });
    },
  } as unknown as MatrixClient);

const readPreview = (mapper: (raw: IEvent) => MatrixEvent) =>
  resolveCachedOverviewUpdate({
    rootId: ROOT,
    room,
    mapper,
    cachedPage: page,
    showCompactRoomView: false,
    compactCachedThreadRootBodyMap: new Map(),
    compactThreadRootBodyMap: new Map(),
  });

describe("an encrypted room's cached thread pages", () => {
  it('give the card the reply once they decrypted', async () => {
    const mx = client();
    // Read as they are mapped, the copies are still ciphertext.
    expect(readPreview(mx.getEventMapper())?.nextReplyPreviewText).toBeUndefined();

    const mapper = await mapCachedPagesForOverview(mx, room, [page]);
    const update = readPreview(mapper);
    expect(update?.nextReplyPreviewText).toBe('word1 word2');
    expect(update?.nextLastSenderId).toBe(HELPER);
  });

  it('are read as they are in a room without encryption', async () => {
    const mx = client();
    const unencrypted = { ...room, hasEncryptionStateEvent: () => false } as unknown as Room;
    const mapper = await mapCachedPagesForOverview(mx, unencrypted, [page]);
    expect(mapper(encrypted('$reply', 2)).getType()).toBe('m.room.encrypted');
  });
});
