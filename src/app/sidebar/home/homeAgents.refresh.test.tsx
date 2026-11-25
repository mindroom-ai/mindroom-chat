// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { act, renderHook } from '@testing-library/react';
import {
  EventType,
  MatrixEventEvent,
  RelationType,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useHomeAgents } from './homeAgents';

const ME = '@robin:example.org';
const HELPER = '@mindroom_helper:example.org';
const SCOUT = '@mindroom_scout:example.org';

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
});
