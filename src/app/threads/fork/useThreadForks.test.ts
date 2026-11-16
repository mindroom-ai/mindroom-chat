// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, renderHook } from '@testing-library/react';
import { MatrixEvent, RoomEvent, ThreadEvent, type Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { groupThreadForks, useThreadForks } from './useThreadForks';

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
  const emitter = new EventEmitter();
  const state = { threadRoots, timelineEvents };
  const room = Object.assign(emitter, {
    roomId: ROOM,
    getThreads: () => state.threadRoots.map((rootEvent) => ({ rootEvent })),
    getUnfilteredTimelineSet: () => ({
      getTimelines: () => [{ getEvents: () => state.timelineEvents }],
    }),
  }) as unknown as Room;
  return { room, state, emitter };
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
    const { room, state, emitter } = makeRoom([], []);
    const { result } = renderHook(() => useThreadForks(room, '$p'));
    expect(result.current.size).toBe(0);

    const fork = root('$f', 20, { thread_id: '$p', event_id: '$a' });
    state.timelineEvents = [fork];
    act(() => {
      emitter.emit(RoomEvent.Timeline, fork);
    });
    expect(result.current.get('$a')).toEqual([{ threadId: '$f', ts: 20 }]);

    const same = result.current;
    act(() => {
      emitter.emit(RoomEvent.Timeline, root('$unrelated', 21));
    });
    expect(result.current).toBe(same);

    const lateThread = root('$g', 25, { thread_id: '$p', event_id: '$a' });
    state.threadRoots = [lateThread];
    act(() => {
      emitter.emit(ThreadEvent.New, { rootEvent: lateThread });
    });
    expect(result.current.get('$a')?.map((f) => f.threadId)).toEqual(['$f', '$g']);
  });
});
