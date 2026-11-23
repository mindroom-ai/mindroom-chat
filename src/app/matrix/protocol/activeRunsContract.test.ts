import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import {
  MINDROOM_ACTIVE_RUNS_EVENT,
  parseActiveRunsStateEvent,
  roomActiveRuns,
  selectActiveRuns,
} from './activeRunsContract';

const DEFAULT_ACTIVE_RUNS_TTL_MS = 180_000;
const MIN_ACTIVE_RUNS_TTL_MS = 30_000;
const MAX_ACTIVE_RUNS_TTL_MS = 600_000;

const VIEWER = '@me:example.org';
const AGENT = '@mindroom_helper:example.org';
const OTHER_AGENT = '@mindroom_team_dev:example.org';
const HUMAN = '@alice:example.org';
const NOW = 1_763_839_200_000;

let nextId = 0;

const activeRunsEvent = ({
  sender = AGENT,
  stateKey = sender,
  ts = NOW,
  content = {
    version: 1,
    updated_at: ts,
    ttl_ms: DEFAULT_ACTIVE_RUNS_TTL_MS,
    threads: [{ thread_id: '$root1' }],
  },
}: {
  sender?: string;
  stateKey?: string;
  ts?: number;
  content?: Record<string, unknown>;
} = {}) =>
  new MatrixEvent({
    event_id: `$ev_${++nextId}`,
    room_id: '!room:example.org',
    sender,
    state_key: stateKey,
    type: MINDROOM_ACTIVE_RUNS_EVENT,
    origin_server_ts: ts,
    content,
  });

const membershipEvent = (userId: string, membership: string) =>
  new MatrixEvent({
    event_id: `$mem_${++nextId}`,
    room_id: '!room:example.org',
    sender: userId,
    state_key: userId,
    type: 'm.room.member',
    origin_server_ts: NOW - 10_000,
    content: { membership },
  });

const makeRoom = (lazyLoadMembers = false) =>
  new Room(
    '!room:example.org',
    createClient({ baseUrl: 'http://localhost:1', userId: VIEWER, timelineSupport: true }),
    VIEWER,
    { timelineSupport: true, lazyLoadMembers }
  );

describe('parseActiveRunsStateEvent and selectActiveRuns', () => {
  it('parses threaded and null room-mode runs, dedupes per agent, and keeps null out of threads set', () => {
    const event = activeRunsEvent({
      ts: NOW,
      content: {
        version: 1,
        updated_at: NOW,
        ttl_ms: DEFAULT_ACTIVE_RUNS_TTL_MS,
        threads: [
          { thread_id: '$root1' },
          { thread_id: '$root1' },
          { thread_id: null },
          { thread_id: null },
          { thread_id: '$root2' },
        ],
      },
    });

    const snapshot = selectActiveRuns([event], NOW + 1_000);
    expect(snapshot.runs).toEqual([
      { agentId: AGENT, threadId: '$root1' },
      { agentId: AGENT, threadId: null },
      { agentId: AGENT, threadId: '$root2' },
    ]);
    expect(Array.from(snapshot.threads)).toEqual(['$root1', '$root2']);
    expect(snapshot.nextExpiryTs).toBe(NOW + DEFAULT_ACTIVE_RUNS_TTL_MS + 1);
  });

  it('tracks expiry for room-mode-only runs while keeping threads empty', () => {
    const roomMode = activeRunsEvent({
      ts: NOW,
      content: {
        version: 1,
        updated_at: NOW,
        ttl_ms: 60_000,
        threads: [{ thread_id: null }],
      },
    });
    const snapshot = selectActiveRuns([roomMode], NOW);
    expect(snapshot.runs).toEqual([{ agentId: AGENT, threadId: null }]);
    expect(snapshot.threads.size).toBe(0);
    expect(snapshot.nextExpiryTs).toBe(NOW + 60_000 + 1);
  });

  it('expires whole state strictly when local now > origin_server_ts + clamped ttl_ms', () => {
    const lowTtl = activeRunsEvent({
      ts: NOW,
      content: {
        version: 1,
        updated_at: NOW,
        ttl_ms: 5_000,
        threads: [{ thread_id: '$low' }],
      },
    });
    expect(selectActiveRuns([lowTtl], NOW + MIN_ACTIVE_RUNS_TTL_MS).threads.has('$low')).toBe(true);
    expect(selectActiveRuns([lowTtl], NOW + MIN_ACTIVE_RUNS_TTL_MS + 1).threads.has('$low')).toBe(
      false
    );

    const highTtl = activeRunsEvent({
      ts: NOW,
      content: {
        version: 1,
        updated_at: NOW,
        ttl_ms: 9_999_999,
        threads: [{ thread_id: '$high' }],
      },
    });
    expect(selectActiveRuns([highTtl], NOW + MAX_ACTIVE_RUNS_TTL_MS).threads.has('$high')).toBe(
      true
    );
    expect(selectActiveRuns([highTtl], NOW + MAX_ACTIVE_RUNS_TTL_MS + 1).threads.has('$high')).toBe(
      false
    );

    const defaultTtl = activeRunsEvent({
      ts: NOW,
      content: { version: 1, updated_at: NOW, threads: [{ thread_id: '$def' }] },
    });
    expect(
      selectActiveRuns([defaultTtl], NOW + DEFAULT_ACTIVE_RUNS_TTL_MS).threads.has('$def')
    ).toBe(true);
    expect(
      selectActiveRuns([defaultTtl], NOW + DEFAULT_ACTIVE_RUNS_TTL_MS + 1).threads.has('$def')
    ).toBe(false);
  });

  it('tracks the earliest expiry across multiple agents and omits idle empty states', () => {
    const soon = activeRunsEvent({
      sender: AGENT,
      ts: NOW,
      content: { version: 1, updated_at: NOW, ttl_ms: 60_000, threads: [{ thread_id: '$t1' }] },
    });
    const later = activeRunsEvent({
      sender: OTHER_AGENT,
      ts: NOW,
      content: { version: 1, updated_at: NOW, ttl_ms: 180_000, threads: [{ thread_id: '$t2' }] },
    });
    const idle = activeRunsEvent({
      sender: '@mindroom_idle:example.org',
      ts: NOW - 10_000,
      content: { version: 1, updated_at: NOW - 10_000, ttl_ms: 30_000, threads: [] },
    });

    const snapshot = selectActiveRuns([soon, later, idle], NOW);
    expect(snapshot.nextExpiryTs).toBe(NOW + 60_000 + 1);
    expect(selectActiveRuns([idle], NOW).nextExpiryTs).toBeUndefined();
  });

  it('ignores malformed content and invalid thread entries', () => {
    const malformed = [
      activeRunsEvent({ content: { version: 2, updated_at: NOW, threads: [{ thread_id: '$t' }] } }),
      activeRunsEvent({ content: { version: 1, threads: [{ thread_id: '$t' }] } }),
      activeRunsEvent({
        content: { version: 1, updated_at: '1000', threads: [{ thread_id: '$t' }] },
      }),
      activeRunsEvent({
        content: { version: 1, updated_at: Number.NaN, threads: [{ thread_id: '$t' }] },
      }),
      activeRunsEvent({ content: { version: 1, updated_at: NOW, threads: 'not-an-array' } }),
      activeRunsEvent({
        content: { version: 1, updated_at: NOW, ttl_ms: '180000', threads: [{ thread_id: '$t' }] },
      }),
      activeRunsEvent({
        content: {
          version: 1,
          updated_at: NOW,
          ttl_ms: Number.NaN,
          threads: [{ thread_id: '$t' }],
        },
      }),
      activeRunsEvent({ ts: 0 }),
    ];
    for (const event of malformed) {
      expect(parseActiveRunsStateEvent(event, NOW)).toBeUndefined();
    }

    const mixedEntries = activeRunsEvent({
      content: {
        version: 1,
        updated_at: NOW,
        ttl_ms: 180_000,
        threads: [
          null,
          {},
          { thread_id: '' },
          { thread_id: 42 },
          { thread_id: null },
          { thread_id: '$valid' },
        ],
      },
    });
    expect(selectActiveRuns([mixedEntries], NOW).runs).toEqual([
      { agentId: AGENT, threadId: null },
      { agentId: AGENT, threadId: '$valid' },
    ]);
  });
});

describe('roomActiveRuns', () => {
  it('ignores non-agent and non-joined senders, preserves heartbeat identity, and recomputes on expiry', async () => {
    const room = makeRoom();
    await room.addLiveEvents(
      [
        membershipEvent(AGENT, 'join'),
        membershipEvent(OTHER_AGENT, 'leave'),
        membershipEvent(HUMAN, 'join'),
        activeRunsEvent({
          sender: AGENT,
          ts: NOW,
          content: {
            version: 1,
            updated_at: NOW,
            ttl_ms: 30_000,
            threads: [{ thread_id: '$agent_thread' }],
          },
        }),
        activeRunsEvent({
          sender: OTHER_AGENT,
          ts: NOW,
          content: {
            version: 1,
            updated_at: NOW,
            ttl_ms: 30_000,
            threads: [{ thread_id: '$left_agent_thread' }],
          },
        }),
        activeRunsEvent({
          sender: HUMAN,
          ts: NOW,
          content: {
            version: 1,
            updated_at: NOW,
            ttl_ms: 30_000,
            threads: [{ thread_id: '$human_thread' }],
          },
        }),
      ],
      { addToState: true }
    );

    const fresh = roomActiveRuns(room, NOW + 1_000);
    expect(Array.from(fresh.threads)).toEqual(['$agent_thread']);
    expect(roomActiveRuns(room, NOW + 30_000)).toBe(fresh);

    // Heartbeat with same threads preserves `runs` and `threads` identities while extending expiry.
    await room.addLiveEvents(
      [
        activeRunsEvent({
          sender: AGENT,
          ts: NOW + 20_000,
          content: {
            version: 1,
            updated_at: NOW + 20_000,
            ttl_ms: 30_000,
            threads: [{ thread_id: '$agent_thread' }],
          },
        }),
      ],
      { addToState: true }
    );
    const renewed = roomActiveRuns(room, NOW + 20_000);
    expect(renewed.threads).toBe(fresh.threads);
    expect(renewed.runs).toBe(fresh.runs);
    expect(renewed.nextExpiryTs).toBe(NOW + 50_001);

    const expired = roomActiveRuns(room, NOW + 50_001);
    expect(expired.runs).toEqual([]);
    expect(expired.threads.size).toBe(0);
  });

  it('treats missing lazy-loaded membership as joined, excludes explicit leave, and drops redacted state', async () => {
    const room = makeRoom(true);
    const stateEv = activeRunsEvent({
      sender: AGENT,
      ts: NOW,
      content: { version: 1, updated_at: NOW, ttl_ms: 30_000, threads: [{ thread_id: '$lazy' }] },
    });
    await room.addLiveEvents([stateEv], { addToState: true });

    expect(room.getMember(AGENT)).toBeNull();
    expect(roomActiveRuns(room, NOW).threads.has('$lazy')).toBe(true);
    expect(roomActiveRuns(room, NOW + 30_001).threads.size).toBe(0);

    const redaction = new MatrixEvent({
      event_id: '$redaction_1',
      room_id: '!room:example.org',
      sender: AGENT,
      type: 'm.room.redaction',
      redacts: stateEv.getId()!,
      origin_server_ts: NOW + 1_000,
      content: {},
    });
    stateEv.makeRedacted(redaction, room);
    expect(roomActiveRuns(room, NOW + 1_000).threads.size).toBe(0);
    expect(parseActiveRunsStateEvent(stateEv, NOW + 1_000)).toBeUndefined();

    await room.addLiveEvents(
      [
        activeRunsEvent({
          sender: AGENT,
          ts: NOW + 2_000,
          content: {
            version: 1,
            updated_at: NOW + 2_000,
            ttl_ms: 30_000,
            threads: [{ thread_id: '$lazy2' }],
          },
        }),
        membershipEvent(AGENT, 'leave'),
      ],
      { addToState: true }
    );
    expect(roomActiveRuns(room, NOW + 2_000).threads.size).toBe(0);
  });

  it('accepts active_runs from a custom-username agent vouched for by the room trusted roster', async () => {
    const room = makeRoom();
    const router = '@mindroom_router:example.org';
    const jarvis = '@jarvis:example.org';
    await room.addLiveEvents(
      [
        new MatrixEvent({
          event_id: `$pl_${++nextId}`,
          room_id: '!room:example.org',
          sender: router,
          state_key: '',
          type: 'm.room.power_levels',
          origin_server_ts: NOW - 10_000,
          content: { users_default: 0, state_default: 50, users: { [router]: 100 } },
        }),
        membershipEvent(router, 'join'),
        membershipEvent(jarvis, 'join'),
        new MatrixEvent({
          event_id: `$rt_${++nextId}`,
          room_id: '!room:example.org',
          sender: router,
          state_key: '',
          type: 'io.mindroom.router',
          origin_server_ts: NOW - 5_000,
          content: { user_id: router },
        }),
        new MatrixEvent({
          event_id: `$ac_${++nextId}`,
          room_id: '!room:example.org',
          sender: router,
          state_key: router,
          type: 'io.mindroom.accounts',
          origin_server_ts: NOW - 5_000,
          content: { accounts: [jarvis] },
        }),
        activeRunsEvent({
          sender: jarvis,
          ts: NOW,
          content: {
            version: 1,
            updated_at: NOW,
            ttl_ms: 60_000,
            threads: [{ thread_id: '$custom_agent_thread' }],
          },
        }),
      ],
      { addToState: true }
    );

    const snap = roomActiveRuns(room, NOW + 1_000);
    expect(snap.runs).toEqual([{ agentId: jarvis, threadId: '$custom_agent_thread' }]);
    expect(snap.threads.has('$custom_agent_thread')).toBe(true);
  });
});
