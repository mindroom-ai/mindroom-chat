// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSessionId } from '../matrix/session/sessions';
import { recordCanvasEvent } from './canvasIndex';
import { listCanvases } from './canvasIndexStore';

// Deleting a canvas in an encrypted room. The SDK applies a redaction to its target before it
// reports the redaction, and a redacted encrypted event loses its decrypted part, so its type is
// m.room.encrypted again by then: the canvas stayed listed, and the header kept its button.
const ROOM_ID = '!secure:example.org';
const AGENT = '@mindroom_planner:example.org';
const VIEWER = '@alice:example.org';
const HOMESERVER = 'https://example.org';
const SESSION = createSessionId(HOMESERVER, VIEWER);

/** A canvas request as the SDK holds it once decrypted. */
const encryptedCanvas = () => {
  const event = new MatrixEvent({
    event_id: '$canvas',
    room_id: ROOM_ID,
    sender: AGENT,
    type: 'm.room.message',
    origin_server_ts: 1,
    content: {
      msgtype: 'm.notice',
      body: 'Interactive panel: Plans.',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
      'io.mindroom.ui_action': {
        version: 1,
        action: 'show_canvas',
        requester_id: VIEWER,
        agent_user_id: AGENT,
        room_id: ROOM_ID,
        thread_id: '$thread',
        canvas: { title: 'Plans', html: '<p>Hi</p>' },
      },
    },
  });
  event.makeEncrypted('m.room.encrypted', { algorithm: 'm.megolm.v1.aes-sha2' }, 'curve', 'ed');
  return event;
};

const redactionOf = (redacts: string) =>
  new MatrixEvent({
    event_id: `$redacts-${redacts}`,
    room_id: ROOM_ID,
    sender: VIEWER,
    type: 'm.room.redaction',
    redacts,
    content: {},
  });

const redact = (event: MatrixEvent) => {
  event.makeRedacted(redactionOf(event.getId() ?? ''), {
    getMyMembership: () => 'join',
    currentState: { getStateEvents: () => null },
  } as never);
};

const fixture = () => {
  const timeline: MatrixEvent[] = [];
  const room = {
    roomId: ROOM_ID,
    getMember: (userId: string) => ({ userId, membership: 'join' }),
    findEventById: (id: string) => timeline.find((event) => event.getId() === id),
  } as unknown as Room;
  const mx = {
    getSafeUserId: () => VIEWER,
    getHomeserverUrl: () => HOMESERVER,
    getRoom: (roomId: string) => (roomId === ROOM_ID ? room : null),
    relations: () => Promise.reject(new Error('not loaded')),
  } as unknown as MatrixClient;
  return { mx, timeline };
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('a canvas deleted in an encrypted room', () => {
  it('leaves the list when its deletion arrives after the SDK redacted it', async () => {
    const { mx, timeline } = fixture();
    const canvas = encryptedCanvas();
    timeline.push(canvas);
    await recordCanvasEvent(mx, canvas);
    expect(await listCanvases(SESSION)).toHaveLength(1);

    redact(canvas);
    expect(canvas.getType()).toBe('m.room.encrypted');
    await recordCanvasEvent(mx, redactionOf('$canvas'));
    expect(await listCanvases(SESSION)).toEqual([]);
  });

  it('leaves the list when it turns up already deleted', async () => {
    const { mx } = fixture();
    await recordCanvasEvent(mx, encryptedCanvas());
    const deleted = encryptedCanvas();
    redact(deleted);
    await recordCanvasEvent(mx, deleted);
    expect(await listCanvases(SESSION)).toEqual([]);
  });

  it('leaves the store alone when an encrypted event of someone else is deleted', async () => {
    const { mx, timeline } = fixture();
    await recordCanvasEvent(mx, encryptedCanvas());
    const own = new MatrixEvent({
      event_id: '$own',
      room_id: ROOM_ID,
      sender: VIEWER,
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'Hello' },
    });
    own.makeEncrypted('m.room.encrypted', { algorithm: 'm.megolm.v1.aes-sha2' }, 'c', 'e');
    timeline.push(own);
    redact(own);
    expect(recordCanvasEvent(mx, redactionOf('$own'))).toBeUndefined();
    expect(await listCanvases(SESSION)).toHaveLength(1);
  });
});
