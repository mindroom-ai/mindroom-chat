// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { MINDROOM_SERVER_EVENT } from '../../computer/agentServer';
import { MINDROOM_ACTIVE_RUNS_EVENT, roomActiveRuns } from './activeRunsContract';
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
      useAgentRoomState(room, TYPE, (events) => events.map((e) => e.getSender()), {
        includeTrustedRoster: true,
      })
    );
    // Without router + roster, non-mindroom_ account is untrusted.
    expect(result.current).toEqual([]);
    expect(agentRoomState(room, TYPE, { includeTrustedRoster: true })).toEqual([]);

    // Adding trusted router binding + accounts roster enables @jarvis:example.org when opted in,
    // while default agentRoomState (includeTrustedRoster: false) still rejects it.
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
    expect(agentRoomState(room, TYPE)).toEqual([]);

    // When @jarvis leaves, its state is dropped immediately.
    await act(async () => {
      await room.addLiveEvents([ev('m.room.member', jarvis, jarvis, { membership: 'leave' })], {
        addToState: true,
      });
    });
    expect(result.current).toEqual([]);
  });

  it('rejects a federated trusted-roster publisher on io.mindroom.server while active_runs accepts a trusted custom-username agent', async () => {
    const federatedAdmin = '@admin:evil.example';
    const federatedPublisher = '@remote_bot:evil.example';
    const jarvis = '@jarvis:example.org';
    const roomId = '!fed:evil.example';
    const now = 1_700_000_000_000;
    const room = new Room(
      roomId,
      createClient({ baseUrl: 'http://localhost:1', userId: viewer, timelineSupport: true }),
      viewer,
      { timelineSupport: true }
    );
    let seq = 0;
    const ev = (type: string, stateKey: string, sender: string, content: Record<string, unknown>) =>
      new MatrixEvent({
        event_id: `$fed_${++seq}`,
        room_id: roomId,
        type,
        state_key: stateKey,
        sender,
        origin_server_ts: now,
        content,
      });

    await room.addLiveEvents(
      [
        ev('m.room.power_levels', '', federatedAdmin, {
          users_default: 0,
          state_default: 50,
          users: { [federatedAdmin]: 100 },
        }),
        ev('m.room.member', federatedAdmin, federatedAdmin, { membership: 'join' }),
        ev('m.room.member', federatedPublisher, federatedPublisher, { membership: 'join' }),
        ev('m.room.member', jarvis, jarvis, { membership: 'join' }),
        ev(MINDROOM_ROUTER_STATE_EVENT, '', federatedAdmin, { user_id: federatedAdmin }),
        ev(MINDROOM_ACCOUNTS_STATE_EVENT, federatedAdmin, federatedAdmin, {
          accounts: [federatedPublisher, jarvis],
        }),
        ev(MINDROOM_SERVER_EVENT, federatedPublisher, federatedPublisher, {
          api_url: 'https://evil.example',
        }),
        ev(MINDROOM_ACTIVE_RUNS_EVENT, jarvis, jarvis, {
          version: 1,
          updated_at: now,
          ttl_ms: 60_000,
          threads: [{ thread_id: '$t1' }],
        }),
      ],
      { addToState: true }
    );

    // io.mindroom.server stays strictly on same-homeserver isMindroomAgentUserIdForViewer.
    expect(agentRoomState(room, MINDROOM_SERVER_EVENT)).toEqual([]);
    const { result: serverHook } = renderHook(() =>
      useAgentRoomState(room, MINDROOM_SERVER_EVENT, (events) => events.map((e) => e.getSender()))
    );
    expect(serverHook.current).toEqual([]);

    // io.mindroom.active_runs opts into trusted-roster acceptance for custom-username agents.
    const runs = roomActiveRuns(room, now + 1_000);
    expect(runs.runs).toEqual([{ agentId: jarvis, threadId: '$t1' }]);
    expect(runs.threads.has('$t1')).toBe(true);
  });

  it('skips trusted-roster state lookups when all state events are already from mindroom_* agents', async () => {
    const roomId = '!fast:example.org';
    const room = new Room(
      roomId,
      createClient({ baseUrl: 'http://localhost:1', userId: viewer, timelineSupport: true }),
      viewer,
      { timelineSupport: true }
    );
    await room.addLiveEvents(
      [
        new MatrixEvent({
          event_id: '$m1',
          room_id: roomId,
          type: 'm.room.member',
          state_key: agent,
          sender: agent,
          origin_server_ts: 1_000,
          content: { membership: 'join' },
        }),
        new MatrixEvent({
          event_id: '$ar1',
          room_id: roomId,
          type: MINDROOM_ACTIVE_RUNS_EVENT,
          state_key: agent,
          sender: agent,
          origin_server_ts: 2_000,
          content: { version: 1, updated_at: 2_000, threads: [{ thread_id: '$t1' }] },
        }),
      ],
      { addToState: true }
    );

    const spy = vi.spyOn(room.currentState, 'getStateEvents');
    const events = agentRoomState(room, MINDROOM_ACTIVE_RUNS_EVENT, {
      includeTrustedRoster: true,
    });
    expect(events.map((e) => e.getSender())).toEqual([agent]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(MINDROOM_ACTIVE_RUNS_EVENT);
  });
});
