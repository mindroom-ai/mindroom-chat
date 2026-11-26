// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import {
  EventType,
  MatrixEventEvent,
  RelationType,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomState,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { MINDROOM_SERVER_EVENT } from '../../computer/agentServer';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useStateEventCallback } from '../../matrix/hooks/useStateEventCallback';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { StateEvent } from '../../matrix/types/room';
import {
  crossRoomThreadIndexAtom,
  emptyCrossRoomThreadIndexSnapshot,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { useHomeAgents } from './homeAgents';

const ME = '@robin:example.org';
const HUMAN = '@alex:example.org';
const HELPER = '@mindroom_helper:example.org';
const SCOUT = '@mindroom_scout:example.org';
const CODER = '@mindroom_coder:example.org';
const ROUTER = '@mindroom_router:example.org';

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: vi.fn() }));
vi.mock('../../matrix/hooks/useStateEventCallback', () => ({ useStateEventCallback: vi.fn() }));
vi.mock('../../matrix/state/archivedRooms', async () => {
  const { atom } = await import('jotai');
  return { navigationRoomsAtom: atom(['!lobby', '!eng']) };
});

const message = (sender: string, ts: number, type: string = EventType.RoomMessage, edit = false) =>
  ({
    getSender: () => sender,
    getStateKey: () => sender,
    getTs: () => ts,
    getType: () => type,
    isState: () => false,
    isRedacted: () => false,
    isDecryptionFailure: () => false,
    getRelation: () => (edit ? { rel_type: RelationType.Replace } : null),
    getContent: () => ({}),
  }) as unknown as MatrixEvent;

/** A room both agents publish their state in, with the messages the client has loaded. */
const room = (roomId: string, messages: MatrixEvent[]) =>
  ({
    roomId,
    myUserId: ME,
    isSpaceRoom: () => false,
    getMyMembership: () => 'join',
    getMember: () => null,
    currentState: {
      getStateEvents: (type: string) =>
        type === 'io.mindroom.server' ? [message(HELPER, 0), message(SCOUT, 0)] : [],
    },
    getLiveTimeline: () => ({
      getEvents: () => messages,
      getState: () => ({ getStateEvents: () => undefined }),
    }),
    getThreads: () => [],
  }) as unknown as Room;

describe('useHomeAgents', () => {
  it("reads the agents again as one answers in a room's timeline, not as people write", () => {
    const lobby: MatrixEvent[] = [message(SCOUT, 100)];
    const rooms = [room('!lobby', lobby), room('!eng', [message(HELPER, 200)])];
    const mx = Object.assign(new EventEmitter(), {
      getRoom: (roomId: string) => rooms.find((each) => each.roomId === roomId) ?? null,
      getAccountData: () => undefined,
    });
    vi.mocked(useMatrixClient).mockReturnValue(mx as unknown as MatrixClient);
    const { result, unmount } = renderHook(() => useHomeAgents());
    const order = () => result.current.map((agent) => agent.userId);
    const arrive = (event: MatrixEvent, name: string = RoomEvent.Timeline) => {
      lobby.push(event);
      act(() => {
        mx.emit(name, event);
      });
    };
    expect(order()).toEqual([HELPER, SCOUT]);

    // A person's message, an agent's edit of an old answer, and an answer not yet decrypted
    // change nothing, and read nothing again.
    const before = result.current;
    arrive(message(ME, 300));
    arrive(message(SCOUT, 310, EventType.RoomMessage, true));
    const encrypted = message(SCOUT, 320, EventType.RoomMessageEncrypted);
    arrive(encrypted);
    expect(result.current).toBe(before);

    // Scout's new answer puts it first: as it arrives, or once it is decrypted.
    arrive(message(SCOUT, 330));
    expect(order()).toEqual([SCOUT, HELPER]);
    expect(result.current[0]?.lastUsedTs).toBe(330);
    arrive(message(HELPER, 400), MatrixEventEvent.Decrypted);
    expect(order()).toEqual([HELPER, SCOUT]);

    unmount();
    expect(mx.listenerCount(RoomEvent.Timeline)).toBe(0);
    expect(mx.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });

  it('reads the agents again as the members of a room load, and as a message is redacted', () => {
    let redacted = false;
    const answer = Object.assign(message(SCOUT, 300), { isRedacted: () => redacted });
    // A chat of two `m.direct` lists for Helper, its members not loaded yet.
    const members: { userId: string; membership: string }[] = [];
    const dm = Object.assign(room('!dm', []), {
      getJoinedMemberCount: () => 2,
      getInvitedMemberCount: () => 0,
      membersLoaded: () => members.length > 0,
      getMembers: () => members,
      getMember: (userId: string) => members.find((member) => member.userId === userId) ?? null,
    });
    const rooms = [room('!lobby', [answer]), room('!eng', [message(HELPER, 200)]), dm];
    const mx = Object.assign(new EventEmitter(), {
      getRoom: (roomId: string) => rooms.find((each) => each.roomId === roomId) ?? null,
      getAccountData: () => ({ getContent: () => ({ [HELPER]: ['!dm'] }) }),
    });
    vi.mocked(useMatrixClient).mockReturnValue(mx as unknown as MatrixClient);
    const { result, unmount } = renderHook(() => useHomeAgents());
    const helper = () => result.current.find((agent) => agent.userId === HELPER);
    expect(result.current.map((agent) => agent.userId)).toEqual([SCOUT, HELPER]);
    expect(helper()?.direct).toBeUndefined();

    // Its members load, Helper among them: no state event says so.
    members.push({ userId: HELPER, membership: 'join' });
    act(() => {
      mx.emit(RoomStateEvent.Members);
    });
    expect(helper()?.direct).toEqual({ roomId: '!dm', waiting: false });

    // Scout's answer is redacted: it no longer puts Scout first.
    redacted = true;
    act(() => {
      mx.emit(RoomEvent.Redaction);
    });
    expect(result.current.map((agent) => agent.userId)).toEqual([HELPER, SCOUT]);

    unmount();
    expect(mx.listenerCount(RoomStateEvent.Members)).toBe(0);
    expect(mx.listenerCount(RoomEvent.Redaction)).toBe(0);
  });

  it('ignores irrelevant state, member, redaction, and router events without re-rendering or reading', () => {
    const store = createStore();
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set(['!dm']) });
    let reads = 0;
    const lobby = Object.assign(room('!lobby', [message(SCOUT, 100)]), {
      getThreads: () => {
        reads += 1;
        return [];
      },
    });
    const eng = room('!eng', [message(HELPER, 200)]);
    const humanOnly = Object.assign(room('!human-only', []), {
      currentState: { getStateEvents: () => [] },
    });
    const rooms = [lobby, eng, humanOnly];
    const mx = Object.assign(new EventEmitter(), {
      getUserId: () => ME,
      getRoom: (roomId: string) => rooms.find((each) => each.roomId === roomId) ?? null,
      getAccountData: () => undefined,
    });
    vi.mocked(useMatrixClient).mockReturnValue(mx as unknown as MatrixClient);

    let renders = 0;
    const { result, unmount } = renderHook(
      () => {
        renders += 1;
        return useHomeAgents();
      },
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(Provider, { store }, children),
      }
    );

    const onStateEvent = vi.mocked(useStateEventCallback).mock.lastCall?.[1];
    expect(onStateEvent).toBeTypeOf('function');

    const before = result.current;
    const rendersBefore = renders;
    reads = 0;

    const stateEvt = (type: string, stateKey = '', roomId = '!lobby') =>
      ({
        getType: () => type,
        getStateKey: () => stateKey,
        getRoomId: () => roomId,
        isState: () => true,
        getContent: () => ({}),
      }) as unknown as MatrixEvent;
    const roomState = (roomId: string) => ({ roomId }) as unknown as RoomState;

    act(() => {
      onStateEvent?.(
        stateEvt('io.mindroom.active_runs', HELPER, '!lobby'),
        roomState('!lobby'),
        null
      );
      onStateEvent?.(stateEvt(StateEvent.RoomTopic, '', '!lobby'), roomState('!lobby'), null);
      onStateEvent?.(stateEvt(StateEvent.RoomMember, HUMAN, '!lobby'), roomState('!lobby'), null);
      mx.emit(
        RoomStateEvent.Members,
        stateEvt(StateEvent.RoomMember, HUMAN, '!lobby'),
        roomState('!lobby'),
        { userId: HUMAN }
      );
      mx.emit(RoomEvent.Redaction, message(HUMAN, 250), humanOnly);
      mx.emit(RoomEvent.Timeline, message(ROUTER, 500));
    });

    expect(reads).toBe(0);
    expect(renders).toBe(rendersBefore);
    expect(result.current).toBe(before);

    unmount();
  });

  it('refreshes on relevant state events only once per change and keeps array reference when unchanged', () => {
    const store = createStore();
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set(['!dm']) });
    const stateCallbackCallsBefore = vi.mocked(useStateEventCallback).mock.calls.length;

    let reads = 0;
    let lobbyAgents = [HELPER, SCOUT];
    let lobbyTombstone = false;
    let engRestricted = false;
    let helperName = 'Helper';
    const dmMembers = [
      { userId: ME, membership: 'join' },
      { userId: HELPER, membership: 'join' },
    ];

    const makeMember = (userId: string) =>
      userId === HELPER
        ? { userId, membership: 'join', rawDisplayName: helperName, getMxcAvatarUrl: () => null }
        : null;

    const lobby = {
      ...room('!lobby', [message(SCOUT, 100)]),
      getMember: makeMember,
      currentState: {
        getStateEvents: (type: string) =>
          type === MINDROOM_SERVER_EVENT ? lobbyAgents.map((id) => message(id, 0)) : [],
      },
      getLiveTimeline: () => ({
        getEvents: () => [message(SCOUT, 100)],
        getState: () => ({
          getStateEvents: (type: string) =>
            type === (StateEvent.RoomTombstone as string) && lobbyTombstone
              ? ({ getContent: () => ({ replacement_room: '!next' }) } as unknown as MatrixEvent)
              : undefined,
        }),
      }),
      getThreads: () => {
        reads += 1;
        return [];
      },
    } as unknown as Room;

    const eng = {
      ...room('!eng', [message(HELPER, 200)]),
      getMember: makeMember,
      getLiveTimeline: () => ({
        getEvents: () => [message(HELPER, 200)],
        getState: () => ({
          getStateEvents: (type: string) =>
            type === (StateEvent.RoomPowerLevels as string) && engRestricted
              ? ({ getContent: () => ({ events_default: 100 }) } as unknown as MatrixEvent)
              : undefined,
        }),
      }),
    } as unknown as Room;

    const dm = {
      ...room('!dm', []),
      getJoinedMemberCount: () => dmMembers.length,
      getInvitedMemberCount: () => 0,
      membersLoaded: () => true,
      getMembers: () => dmMembers,
      getMember: (userId: string) => dmMembers.find((m) => m.userId === userId) ?? null,
      currentState: { getStateEvents: () => [] },
    } as unknown as Room;

    const rooms = [lobby, eng, dm];
    const mx = Object.assign(new EventEmitter(), {
      getUserId: () => ME,
      getRoom: (roomId: string) => rooms.find((each) => each.roomId === roomId) ?? null,
      getAccountData: () => ({ getContent: () => ({ [HELPER]: ['!dm'] }) }),
    });
    vi.mocked(useMatrixClient).mockReturnValue(mx as unknown as MatrixClient);

    let renders = 0;
    const { result, unmount } = renderHook(
      () => {
        renders += 1;
        return useHomeAgents();
      },
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(Provider, { store }, children),
      }
    );

    const onStateEvent = vi.mocked(useStateEventCallback).mock.lastCall?.[1];
    expect(onStateEvent).toBeTypeOf('function');

    const fireState = (type: string, stateKey = '', roomId = '!lobby') => {
      act(() => {
        onStateEvent?.(
          {
            getType: () => type,
            getStateKey: () => stateKey,
            getRoomId: () => roomId,
            isState: () => true,
            getContent: () => ({}),
          } as unknown as MatrixEvent,
          { roomId } as unknown as RoomState,
          null
        );
      });
    };

    // 20 relevant state events in one sync batch trigger only 1 scan and keep the exact array reference when unchanged.
    const unchangedBefore = result.current;
    reads = 0;
    act(() => {
      for (let i = 0; i < 20; i += 1) {
        onStateEvent?.(
          {
            getType: () =>
              i % 4 === 0
                ? MINDROOM_SERVER_EVENT
                : i % 4 === 1
                  ? StateEvent.RoomPowerLevels
                  : StateEvent.RoomMember,
            getStateKey: () => (i % 4 === 3 ? HUMAN : HELPER),
            getRoomId: () => (i % 4 === 3 ? '!dm' : '!lobby'),
            isState: () => true,
            getContent: () => ({}),
          } as unknown as MatrixEvent,
          { roomId: i % 4 === 3 ? '!dm' : '!lobby' } as unknown as RoomState,
          null
        );
      }
    });
    expect(reads).toBe(1);
    expect(result.current).toBe(unchangedBefore);

    // 1. io.mindroom.server adds an agent (single-pass read + 1 render).
    reads = 0;
    const rendersBeforeAdd = renders;
    lobbyAgents = [HELPER, SCOUT, CODER];
    fireState(MINDROOM_SERVER_EVENT, CODER, '!lobby');
    expect(reads).toBe(1);
    expect(renders).toBe(rendersBeforeAdd + 1);
    expect(result.current.map((a) => a.userId)).toEqual([HELPER, SCOUT, CODER]);

    // 2. m.room.tombstone removes !lobby from usable rooms.
    lobbyTombstone = true;
    fireState(StateEvent.RoomTombstone, '', '!lobby');
    expect(result.current.find((a) => a.userId === HELPER)?.roomIds).toEqual(['!eng']);

    // 3. m.room.power_levels revokes sending in !eng.
    engRestricted = true;
    fireState(StateEvent.RoomPowerLevels, '', '!eng');
    expect(result.current.find((a) => a.userId === HELPER)?.roomIds).toEqual([]);

    // 4. Agent m.room.member updates display name.
    helperName = 'Helper Renamed';
    fireState(StateEvent.RoomMember, HELPER, '!lobby');
    expect(result.current.find((a) => a.userId === HELPER)?.name).toBe('Helper Renamed');

    // 5. DM m.room.member adds a third human, invalidating the 1:1 DM.
    expect(result.current.find((a) => a.userId === HELPER)?.direct).toEqual({
      roomId: '!dm',
      waiting: false,
    });
    dmMembers.push({ userId: HUMAN, membership: 'join' });
    fireState(StateEvent.RoomMember, HUMAN, '!dm');
    expect(result.current.find((a) => a.userId === HELPER)?.direct).toBeUndefined();

    // Callback identity passed to useStateEventCallback stayed stable across all renders.
    const callbacks = vi
      .mocked(useStateEventCallback)
      .mock.calls.slice(stateCallbackCallsBefore)
      .map(([, cb]) => cb);
    expect(new Set(callbacks).size).toBe(1);

    unmount();
  });

  it('skips re-renders on unrelated crossRoomThreadIndexAtom updates and refreshes on agent replies', () => {
    const store = createStore();
    let reads = 0;
    const lobby = Object.assign(room('!lobby', [message(SCOUT, 100)]), {
      getThreads: () => {
        reads += 1;
        return [];
      },
    });
    const rooms = [lobby, room('!eng', [message(HELPER, 200)])];
    const mx = Object.assign(new EventEmitter(), {
      getUserId: () => ME,
      getRoom: (roomId: string) => rooms.find((each) => each.roomId === roomId) ?? null,
      getAccountData: () => undefined,
    });
    vi.mocked(useMatrixClient).mockReturnValue(mx as unknown as MatrixClient);

    let renders = 0;
    const { result, unmount } = renderHook(
      () => {
        renders += 1;
        return useHomeAgents();
      },
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(Provider, { store }, children),
      }
    );

    const makeEntry = (
      roomId: string,
      threadRootId: string,
      lastSenderId: string,
      latestReplyTs: number,
      opts: { encrypted?: boolean; tags?: string[]; isResolved?: boolean } = {}
    ): [string, CrossRoomThreadIndexEntry] => [
      getCrossRoomThreadIndexKey(roomId, threadRootId),
      {
        key: getCrossRoomThreadIndexKey(roomId, threadRootId),
        roomId,
        threadRootId,
        lastActivityTs: latestReplyTs,
        tags: opts.tags ?? [],
        isResolved: opts.isResolved ?? false,
        threadRecord: {
          presentation: {
            lastSenderId,
            latestReplyTs,
            latestReplyPreviewLocalization: opts.encrypted ? { kind: 'encrypted' } : undefined,
          },
        },
      } as unknown as CrossRoomThreadIndexEntry,
    ];

    const setIndex = (items: [string, CrossRoomThreadIndexEntry][], version: number) => {
      act(() => {
        store.set(crossRoomThreadIndexAtom, {
          ...emptyCrossRoomThreadIndexSnapshot(),
          entries: new Map(items),
          version,
          bootstrapped: true,
        });
      });
    };

    const before = result.current;
    const rendersBefore = renders;
    reads = 0;

    // Human reply, tag/pin/resolved churn, encrypted agent preview, and router reply do not re-render.
    setIndex([makeEntry('!lobby', '$t1', HUMAN, 900, { tags: ['pinned'], isResolved: false })], 1);
    setIndex(
      [makeEntry('!lobby', '$t1', HUMAN, 900, { tags: ['pinned', 'triage'], isResolved: true })],
      2
    );
    setIndex([makeEntry('!lobby', '$t2', SCOUT, 950, { encrypted: true })], 3);
    setIndex([makeEntry('!lobby', '$t3', ROUTER, 990)], 4);
    expect(renders).toBe(rendersBefore);
    expect(reads).toBe(0);
    expect(result.current).toBe(before);

    // Non-encrypted agent latestReplyTs update refreshes and moves Scout ahead of Helper.
    setIndex([makeEntry('!lobby', '$t4', SCOUT, 500), makeEntry('!eng', '$t5', HELPER, 200)], 5);
    expect(result.current.map((a) => a.userId)).toEqual([SCOUT, HELPER]);
    expect(result.current[0]?.lastUsedTs).toBe(500);

    // Reordering identical agent entries in the Map produces the same signature -> zero re-renders.
    const afterUpdate = result.current;
    const rendersAfterUpdate = renders;
    reads = 0;
    setIndex([makeEntry('!eng', '$t5', HELPER, 200), makeEntry('!lobby', '$t4', SCOUT, 500)], 6);
    expect(renders).toBe(rendersAfterUpdate);
    expect(reads).toBe(0);
    expect(result.current).toBe(afterUpdate);

    unmount();
  });

  it('refreshes when RoomEvent.Summary on a direct room drops member count from 3 to 2', () => {
    const store = createStore();
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set(['!dm']) });
    let joinedCount = 3;
    const dmMembers = [
      { userId: ME, membership: 'join' },
      { userId: HELPER, membership: 'join' },
    ];
    const dm = Object.assign(new EventEmitter(), room('!dm', []), {
      getJoinedMemberCount: () => joinedCount,
      getInvitedMemberCount: () => 0,
      membersLoaded: () => true,
      getMembers: () => dmMembers,
      getMember: (userId: string) => dmMembers.find((m) => m.userId === userId) ?? null,
      currentState: { getStateEvents: () => [] },
    }) as unknown as Room & EventEmitter;
    const rooms = [room('!lobby', [message(SCOUT, 100)]), room('!eng', [message(HELPER, 200)]), dm];
    const mx = Object.assign(new EventEmitter(), {
      getUserId: () => ME,
      getRoom: (roomId: string) => rooms.find((each) => each.roomId === roomId) ?? null,
      getAccountData: () => ({ getContent: () => ({ [HELPER]: ['!dm'] }) }),
    });
    vi.mocked(useMatrixClient).mockReturnValue(mx as unknown as MatrixClient);

    const { result, unmount } = renderHook(() => useHomeAgents(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(Provider, { store }, children),
    });

    expect(result.current.find((a) => a.userId === HELPER)?.direct).toBeUndefined();

    // Third member leaves; SDK updates the room summary count from 3 to 2 via RoomEvent.Summary.
    joinedCount = 2;
    act(() => {
      dm.emit(RoomEvent.Summary, { 'm.joined_member_count': 2, 'm.invited_member_count': 0 });
    });
    expect(result.current.find((a) => a.userId === HELPER)?.direct).toEqual({
      roomId: '!dm',
      waiting: false,
    });

    unmount();
    expect(dm.listenerCount(RoomEvent.Summary)).toBe(0);
  });
});
