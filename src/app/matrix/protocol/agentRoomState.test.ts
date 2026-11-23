// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { agentRoomState, selectAgentSelfState, useAgentRoomState } from './agentRoomState';
import { MINDROOM_ACCOUNTS_STATE_EVENT, MINDROOM_ROUTER_STATE_EVENT } from './routerBinding';

const viewer = '@alice:example.org';
const agent = '@mindroom_code:example.org';
const TYPE = 'io.mindroom.example';

const stateEvent = (sender: string, stateKey = sender) =>
  new MatrixEvent({
    type: TYPE,
    state_key: stateKey,
    sender,
    room_id: '!room:example.org',
    event_id: `$${sender}${stateKey}`,
    origin_server_ts: 1,
    content: {},
  });

describe('agent self-described room state', () => {
  it('keeps state an agent on the viewer homeserver published about itself while it is in the room', () => {
    const event = stateEvent(agent);
    expect(selectAgentSelfState([event], viewer, () => true)).toEqual([event]);
  });

  it.each([
    ['another user', stateEvent(agent, '@mindroom_other:example.org')],
    ['a user who is not an agent', stateEvent('@mallory:example.org')],
    ['an agent on another homeserver', stateEvent('@mindroom_code:evil.example')],
  ])('ignores state describing %s', (_case, event) => {
    expect(selectAgentSelfState([event], viewer, () => true)).toEqual([]);
  });

  it('ignores state from an agent that left the room', () => {
    expect(selectAgentSelfState([stateEvent(agent)], viewer, () => false)).toEqual([]);
  });
});

describe('useAgentRoomState', () => {
  it('reads no state of a room the client does not know', () => {
    const { result } = renderHook(() => useAgentRoomState(null, TYPE, (events) => events.length));
    expect(result.current).toBe(0);
  });

  it('accepts a trusted custom-username roster agent and refreshes when roster or membership changes', async () => {
    const router = '@mindroom_router:example.org';
    const jarvis = '@jarvis:example.org';
    const roomId = '!room:example.org';
    const room = new Room(
      roomId,
      createClient({ baseUrl: 'http://localhost:1', userId: viewer, timelineSupport: true }),
      viewer,
      { timelineSupport: true }
    );
    let seq = 0;
    const ev = (type: string, stateKey: string, sender: string, content: Record<string, unknown>) =>
      new MatrixEvent({
        event_id: `$ev_${++seq}`,
        room_id: roomId,
        type,
        state_key: stateKey,
        sender,
        origin_server_ts: seq * 1_000,
        content,
      });

    await room.addLiveEvents(
      [
        ev('m.room.power_levels', '', router, {
          users_default: 0,
          state_default: 50,
          users: { [router]: 100 },
        }),
        ev('m.room.member', router, router, { membership: 'join' }),
        ev('m.room.member', jarvis, jarvis, { membership: 'join' }),
        ev(TYPE, jarvis, jarvis, { ok: true }),
      ],
      { addToState: true }
    );

    const { result } = renderHook(() =>
      useAgentRoomState(room, TYPE, (events) => events.map((e) => e.getSender()))
    );
    // Without router + roster, non-mindroom_ account is untrusted.
    expect(result.current).toEqual([]);
    expect(agentRoomState(room, TYPE)).toEqual([]);

    // Adding trusted router binding + accounts roster enables @jarvis:example.org immediately.
    await act(async () => {
      await room.addLiveEvents(
        [
          ev(MINDROOM_ROUTER_STATE_EVENT, '', router, { user_id: router }),
          ev(MINDROOM_ACCOUNTS_STATE_EVENT, router, router, { accounts: [jarvis] }),
        ],
        { addToState: true }
      );
    });
    expect(result.current).toEqual([jarvis]);

    // When @jarvis leaves, its state is dropped immediately.
    await act(async () => {
      await room.addLiveEvents([ev('m.room.member', jarvis, jarvis, { membership: 'leave' })], {
        addToState: true,
      });
    });
    expect(result.current).toEqual([]);
  });
});
