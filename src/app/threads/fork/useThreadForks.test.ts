// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, renderHook } from '@testing-library/react';
import { MatrixEvent, MatrixEventEvent, RoomEvent, ThreadEvent, type Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { groupThreadForks, useThreadForks } from './useThreadForks';

const client = vi.hoisted(() => ({ emitter: undefined as unknown as EventEmitter }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => client.emitter }));

const ROOM = '!room:example.org';

const root = (
  eventId: string,
  ts: number,
  fork?: { thread_id: unknown; event_id: unknown },
  extra: Record<string, unknown> = {}
) =>
  new MatrixEvent({
    event_id: eventId,
    room_id: ROOM,
    sender: '@maya:example.org',
    type: 'm.room.message',
    origin_server_ts: ts,
    content: {
      msgtype: 'm.text',
      body: eventId,
      ...(fork ? { 'io.mindroom.fork': fork } : {}),
      ...extra,
    },
  });

describe('groupThreadForks', () => {
  it('groups the roots that fork this thread by fork point, oldest first', () => {
    const forks = groupThreadForks(
      [
        root('$f2', 30, { thread_id: '$p', event_id: '$a' }),
        root('$f1', 20, { thread_id: '$p', event_id: '$a' }),
        root('$f3', 40, { thread_id: '$p', event_id: '$b' }),
      ],
      '$p'
    );
    expect([...forks.keys()]).toEqual(['$a', '$b']);
    expect(forks.get('$a')).toEqual([
      { threadId: '$f1', ts: 20 },
      { threadId: '$f2', ts: 30 },
    ]);
    expect(forks.get('$b')).toEqual([{ threadId: '$f3', ts: 40 }]);
  });

  it('ignores the forks of other threads, plain roots, malformed references and replies', () => {
    const reply = root(
      '$r',
      5,
      { thread_id: '$p', event_id: '$a' },
      {
        'm.relates_to': { rel_type: 'm.thread', event_id: '$other' },
      }
    );
    const forks = groupThreadForks(
      [
        root('$other-fork', 1, { thread_id: '$q', event_id: '$a' }),
        root('$plain', 2),
        root('$bad', 3, { thread_id: '$p', event_id: 'a' }),
        root('$bad2', 4, { thread_id: 7, event_id: '$a' }),
        reply,
      ],
      '$p'
    );
    expect(forks.size).toBe(0);
  });

  it('counts a root once however many sources hold it, and never the thread itself', () => {
    const fork = root('$f', 9, { thread_id: '$p', event_id: '$a' });
    const self = root('$p', 1, { thread_id: '$p', event_id: '$a' });
    const forks = groupThreadForks([fork, fork, self], '$p');
    expect(forks.get('$a')).toEqual([{ threadId: '$f', ts: 9 }]);
  });

  it("reads a root's original content, not an edit's", () => {
    const edited = root('$f', 9, { thread_id: '$p', event_id: '$a' });
    edited.makeReplaced(
      new MatrixEvent({
        event_id: '$edit',
        room_id: ROOM,
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body: '* x',
          'm.new_content': { msgtype: 'm.text', body: 'x' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$f' },
        },
      })
    );
    expect(groupThreadForks([edited], '$p').get('$a')).toEqual([{ threadId: '$f', ts: 9 }]);
  });
});

const makeRoom = (threadRoots: MatrixEvent[], timelineEvents: MatrixEvent[]) => {
  // The client re-emits timeline events of its rooms; the room emits a new thread itself.
  const roomEmitter = new EventEmitter();
  client.emitter = new EventEmitter();
  const state = { threadRoots, timelineEvents };
  const timeline = {
    getEvents: () => state.timelineEvents,
    getNeighbouringTimeline: () => null,
  };
  const room = Object.assign(roomEmitter, {
    roomId: ROOM,
    getThreads: () => state.threadRoots.map((rootEvent) => ({ rootEvent })),
    getUnfilteredTimelineSet: () => ({ getLiveTimeline: () => timeline }),
  }) as unknown as Room;
  return { room, state, emitter: roomEmitter, clientEmitter: client.emitter };
};

describe('useThreadForks', () => {
  it('reads the roots of the room: its threads and its loaded timeline', () => {
    const { room } = makeRoom(
      [root('$f1', 20, { thread_id: '$p', event_id: '$a' })],
      [root('$f2', 30, { thread_id: '$p', event_id: '$b' }), root('$x', 1)]
    );
    const { result } = renderHook(() => useThreadForks(room, '$p'));
    expect([...result.current.keys()]).toEqual(['$a', '$b']);
  });

  it('follows a fork root that arrives later, and ignores the rest', () => {
    const { room, state, emitter, clientEmitter } = makeRoom([], []);
    const { result } = renderHook(() => useThreadForks(room, '$p'));
    expect(result.current.size).toBe(0);

    const fork = root('$f', 20, { thread_id: '$p', event_id: '$a' });
    state.timelineEvents = [fork];
    act(() => {
      clientEmitter.emit(RoomEvent.Timeline, fork, room);
    });
    expect(result.current.get('$a')).toEqual([{ threadId: '$f', ts: 20 }]);

    const same = result.current;
    act(() => {
      clientEmitter.emit(RoomEvent.Timeline, root('$unrelated', 21), room);
    });
    expect(result.current).toBe(same);

    const lateThread = root('$g', 25, { thread_id: '$p', event_id: '$a' });
    state.threadRoots = [lateThread];
    act(() => {
      emitter.emit(ThreadEvent.New, { rootEvent: lateThread });
    });
    expect(result.current.get('$a')?.map((f) => f.threadId)).toEqual(['$f', '$g']);
  });

  it('follows a fork root of an encrypted room once it decrypts, and lets go on unmount', () => {
    const { room, state, clientEmitter } = makeRoom([], []);
    const { result, unmount } = renderHook(() => useThreadForks(room, '$p'));
    // It arrives unreadable: nothing in it names a fork yet.
    const sealed = root('$f', 20);
    state.timelineEvents = [sealed];
    act(() => {
      clientEmitter.emit(RoomEvent.Timeline, sealed, room);
    });
    expect(result.current.size).toBe(0);

    sealed.event.content = {
      msgtype: 'm.text',
      body: 'x',
      'io.mindroom.fork': { thread_id: '$p', event_id: '$a' },
    };
    act(() => {
      clientEmitter.emit(MatrixEventEvent.Decrypted, sealed);
    });
    expect(result.current.get('$a')).toEqual([{ threadId: '$f', ts: 20 }]);

    unmount();
    expect(clientEmitter.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    expect(clientEmitter.listenerCount(RoomEvent.Timeline)).toBe(0);
  });
});
