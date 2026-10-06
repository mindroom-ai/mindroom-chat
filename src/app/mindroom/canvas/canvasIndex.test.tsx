// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import React from 'react';
import { EventEmitter } from 'events';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
  ClientEvent,
  MatrixEvent,
  MatrixEventEvent,
  RoomEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import { loadCanvasEvent, recordCanvasEvent, useCanvasIndexRecorder } from './canvasIndex';
import { listCanvases, subscribeCanvasList } from './canvasIndexStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM_ID = '!room:example.org';
const AGENT = '@mindroom_planner:example.org';
const VIEWER = '@alice:example.org';
const HOMESERVER = 'https://example.org';
const SESSION = createSessionId(HOMESERVER, VIEWER);

const metadata = (title: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  action: 'show_canvas',
  requester_id: VIEWER,
  agent_user_id: AGENT,
  room_id: ROOM_ID,
  thread_id: '$thread',
  canvas: { title, html: '<p>Hi</p>' },
  ...extra,
});

const request = ({ id = '$canvas', ts = 1, extra = {} as Record<string, unknown> } = {}) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: AGENT,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.notice',
      body: 'Interactive panel: Plans.',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
      'io.mindroom.ui_action': metadata('Plans', extra),
    },
  });

const edit = (
  title: string,
  { id = '$edit', ts = 2, sender = AGENT, extra = {} as Record<string, unknown> } = {}
) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.notice',
      body: `* Interactive panel: ${title}.`,
      'm.new_content': {
        msgtype: 'm.notice',
        body: `Interactive panel: ${title}.`,
        'io.mindroom.ui_action': metadata(title, extra),
      },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$canvas' },
    },
  });

type Fixture = {
  mx: MatrixClient & EventEmitter;
  room: Room;
  timeline: MatrixEvent[];
  relations: ReturnType<typeof vi.fn>;
};

const fixture = (): Fixture => {
  const timeline: MatrixEvent[] = [];
  const room = {
    roomId: ROOM_ID,
    getMember: (userId: string) => ({ userId, membership: 'join' }),
    getLiveTimeline: () => ({ getEvents: () => timeline }),
    getThreads: () => [],
    findEventById: (id: string) => timeline.find((event) => event.getId() === id),
  } as unknown as Room;
  const relations = vi.fn();
  const mx = Object.assign(new EventEmitter(), {
    getSafeUserId: () => VIEWER,
    getHomeserverUrl: () => HOMESERVER,
    getRoom: (roomId: string) => (roomId === ROOM_ID ? room : null),
    getRooms: () => [room],
    relations,
  }) as unknown as Fixture['mx'];
  return { mx, room, timeline, relations };
};

const settle = async () => {
  // IndexedDB work finishes over several tasks.
  for (let index = 0; index < 5; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('recordCanvasEvent', () => {
  it('lists a canvas made for the viewer with where it is and whether it is shared', async () => {
    const { mx } = fixture();
    await recordCanvasEvent(mx, request({ extra: { share_state: true } }));
    expect(await listCanvases(SESSION)).toEqual([
      {
        canvasId: '$canvas',
        roomId: ROOM_ID,
        threadId: '$thread',
        agentUserId: AGENT,
        title: 'Plans',
        createdTs: 1,
        updatedTs: 1,
        shared: true,
      },
    ]);
  });

  it('ignores messages that are not canvases for the viewer', async () => {
    const { mx } = fixture();
    const plain = new MatrixEvent({
      event_id: '$plain',
      room_id: ROOM_ID,
      sender: AGENT,
      type: 'm.room.message',
      origin_server_ts: 1,
      content: { msgtype: 'm.text', body: 'Hello' },
    });
    expect(recordCanvasEvent(mx, plain)).toBeUndefined();
    expect(
      recordCanvasEvent(mx, request({ extra: { requester_id: '@bob:example.org' } }))
    ).toBeUndefined();
    const echo = request();
    echo.setStatus('sending' as never);
    expect(recordCanvasEvent(mx, echo)).toBeUndefined();
  });

  it('lists the update a loaded request shows', async () => {
    const { mx } = fixture();
    const canvas = request();
    canvas.makeReplaced(edit('Plans v2', { ts: 7 }));
    await recordCanvasEvent(mx, canvas);
    expect((await listCanvases(SESSION))[0]).toMatchObject({
      title: 'Plans v2',
      createdTs: 1,
      updatedTs: 7,
    });
  });

  it('forgets a canvas that turns up already deleted', async () => {
    const { mx } = fixture();
    await recordCanvasEvent(mx, request());
    const deleted = request();
    deleted.makeRedacted(
      new MatrixEvent({ event_id: '$redaction', type: 'm.room.redaction', redacts: '$canvas' }),
      { getMyMembership: () => 'join', currentState: { getStateEvents: () => null } } as never
    );
    expect(deleted.isRedacted()).toBe(true);
    await recordCanvasEvent(mx, deleted);
    expect(await listCanvases(SESSION)).toEqual([]);
  });

  it('leaves the store alone for deletions that cannot be of a canvas', async () => {
    const { mx, timeline } = fixture();
    await recordCanvasEvent(mx, request());
    const reaction = (id: string) =>
      new MatrixEvent({
        event_id: id,
        room_id: ROOM_ID,
        sender: AGENT,
        type: 'm.reaction',
        content: {},
      });
    const redaction = (redacts: string) =>
      new MatrixEvent({
        event_id: `$redacts-${redacts}`,
        room_id: ROOM_ID,
        sender: AGENT,
        type: 'm.room.redaction',
        redacts,
      });
    const writes = vi.fn();
    const unsubscribe = subscribeCanvasList(writes);
    // Agents delete their stop-button reaction after every reply.
    timeline.push(reaction('$stop'));
    expect(recordCanvasEvent(mx, redaction('$stop'))).toBeUndefined();
    const deletedReaction = reaction('$old-stop');
    deletedReaction.makeRedacted(redaction('$old-stop'), {
      getMyMembership: () => 'join',
      currentState: { getStateEvents: () => null },
    } as never);
    expect(recordCanvasEvent(mx, deletedReaction)).toBeUndefined();
    // A deletion of an event not in memory may be of a canvas.
    await recordCanvasEvent(mx, redaction('$unknown'));
    expect(writes).toHaveBeenCalledTimes(1);
    expect(await listCanvases(SESSION)).toHaveLength(1);
    unsubscribe();
  });

  it('applies an update that arrives without its request, from the canvas agent only', async () => {
    const { mx } = fixture();
    await recordCanvasEvent(mx, request());
    await recordCanvasEvent(mx, edit('Forged', { id: '$forged', ts: 9, sender: '@m:example.org' }));
    // The panel ignores an update that changes what the request is; so does the list.
    await recordCanvasEvent(
      mx,
      edit('Moved', { id: '$moved', ts: 4, extra: { thread_id: '$elsewhere' } })
    );
    expect((await listCanvases(SESSION))[0]).toMatchObject({ title: 'Plans', updatedTs: 1 });
    await recordCanvasEvent(mx, edit('Plans v2', { ts: 5 }));
    expect((await listCanvases(SESSION))[0]).toMatchObject({ title: 'Plans v2', updatedTs: 5 });
  });
});

describe('useCanvasIndexRecorder', () => {
  const mount = (mx: MatrixClient, enabled: boolean) => {
    function Recorder() {
      useCanvasIndexRecorder(mx, enabled);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Recorder />));
    return root;
  };

  it('lists canvases loaded before it started and those that arrive later', async () => {
    const { mx, timeline } = fixture();
    timeline.push(request());
    const root = mount(mx, true);
    await settle();
    expect((await listCanvases(SESSION)).map((listed) => listed.canvasId)).toEqual(['$canvas']);
    mx.emit(RoomEvent.Timeline, request({ id: '$later', ts: 3 }));
    mx.emit(MatrixEventEvent.Decrypted, request({ id: '$decrypted', ts: 4 }));
    await settle();
    expect((await listCanvases(SESSION)).map((listed) => listed.canvasId).sort()).toEqual([
      '$canvas',
      '$decrypted',
      '$later',
    ]);
    // An update whose request is not in memory reaches no timeline; sync still reports it.
    mx.emit(ClientEvent.Event, edit('Plans v2', { ts: 5 }));
    await settle();
    expect(
      (await listCanvases(SESSION)).find((listed) => listed.canvasId === '$canvas')
    ).toMatchObject({ title: 'Plans v2', updatedTs: 5 });
    act(() => root.unmount());
  });

  it('forgets a deleted canvas, also when its request is not in memory', async () => {
    const { mx, timeline } = fixture();
    timeline.push(request());
    const root = mount(mx, true);
    await settle();
    mx.emit(
      ClientEvent.Event,
      new MatrixEvent({
        event_id: '$redaction',
        sender: AGENT,
        type: 'm.room.redaction',
        redacts: '$canvas',
        content: {},
      })
    );
    await settle();
    expect(await listCanvases(SESSION)).toEqual([]);
    act(() => root.unmount());
  });

  it('records nothing while canvases are off', async () => {
    const { mx, timeline } = fixture();
    timeline.push(request());
    const root = mount(mx, false);
    mx.emit(RoomEvent.Timeline, request({ id: '$later' }));
    await settle();
    expect(await listCanvases(SESSION)).toEqual([]);
    act(() => root.unmount());
  });
});

describe('loadCanvasEvent', () => {
  it('returns the loaded copy without asking the server', async () => {
    const { mx, room, timeline, relations } = fixture();
    const canvas = request();
    timeline.push(canvas);
    expect(await loadCanvasEvent(mx, room, '$canvas')).toBe(canvas);
    expect(relations).not.toHaveBeenCalled();
  });

  it('fetches a canvas from the server at its newest valid update', async () => {
    const { mx, room, relations } = fixture();
    relations.mockResolvedValue({
      originalEvent: request(),
      events: [
        edit('Plans v3', { id: '$v3', ts: 5 }),
        edit('Plans v2', { id: '$v2', ts: 3 }),
        // The SDK keeps only the request sender's edits, but an invalid one is skipped too.
        new MatrixEvent({
          event_id: '$bad',
          room_id: ROOM_ID,
          sender: AGENT,
          type: 'm.room.message',
          origin_server_ts: 9,
          content: {
            msgtype: 'm.notice',
            body: '* broken',
            'm.new_content': { msgtype: 'm.notice', body: 'broken' },
            'm.relates_to': { rel_type: 'm.replace', event_id: '$canvas' },
          },
        }),
      ],
    });
    const loaded = await loadCanvasEvent(mx, room, '$canvas');
    expect(loaded?.replacingEventId()).toBe('$v3');
    expect(relations).toHaveBeenCalledWith(
      ROOM_ID,
      '$canvas',
      'm.replace',
      'm.room.message',
      expect.objectContaining({ dir: 'b' })
    );
  });

  it('returns nothing when the server cannot provide it', async () => {
    const { mx, room, relations } = fixture();
    relations.mockRejectedValueOnce(new Error('M_NOT_FOUND'));
    expect(await loadCanvasEvent(mx, room, '$canvas')).toBeUndefined();
    relations.mockResolvedValueOnce({ originalEvent: null, events: [] });
    expect(await loadCanvasEvent(mx, room, '$canvas')).toBeUndefined();
  });
});
