import React from 'react';
import { MatrixEvent, RoomMember, RoomMemberEvent, RoomState, type Room } from 'matrix-js-sdk';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getRenderedEventIds,
  makeEvent,
  makeRoom,
  makeTimeline,
  matrixClientMock,
  roomTimelineVirtualizerState,
  powerLevelsContextMock,
  threadRenderStateMock,
  wrapWithSyncEngine,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const threadId = '$root';
const AGENT = '@mindroom_helper:example.org';
const ROUTER = '@mindroom_router:example.org';
const CUSTOM_AGENT = '@helper:example.org';
const VIEWER = '@alice:example.org';

let roomState: RoomState;
beforeEach(() => {
  roomState = new RoomState('!room:example.org');
});
afterEach(() => {
  powerLevelsContextMock.levels = {};
});

const setRouterBinding = (router: string) => {
  powerLevelsContextMock.levels = { users: { [router]: 50 } };
  roomState.setStateEvents([
    new MatrixEvent({
      type: 'io.mindroom.router',
      room_id: roomState.roomId,
      state_key: '',
      sender: router,
      content: { user_id: router },
    }),
  ]);
};

const setRoster = (accounts: string[]) => {
  roomState.setStateEvents([
    new MatrixEvent({
      type: 'io.mindroom.accounts',
      room_id: roomState.roomId,
      state_key: ROUTER,
      sender: ROUTER,
      content: { accounts },
    }),
  ]);
};

// Exercise the real keyed state hook against the SDK's room state and event emitter.
vi.doUnmock('../../matrix/hooks/useStateEvent');
vi.doMock('../../matrix/hooks/useRoomCreators', () => {
  const creators = new Set<string>();
  return { useRoomCreators: () => creators };
});
const makeRoomWithState = (...args: Parameters<typeof makeRoom>) => {
  const room = makeRoom(...args);
  Object.assign(room.getLiveTimeline(), { getState: () => roomState });
  Object.assign(room.client, {
    on: roomState.on.bind(roomState),
    removeListener: roomState.removeListener.bind(roomState),
  });
  return room;
};

// Its own test draws it; here only that the voice row shows it counts.
vi.mock('../../messages/content/VoiceTranscript', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../messages/content/VoiceTranscript')>()),
  VoiceTranscript: ({ content }: { content: { body: string } }) =>
    React.createElement('p', { 'data-voice-transcript': content.body }),
}));

importBeforeTests(() => import('../RoomTimeline'));

/** A thread with a voice message and its echo, the room's state naming `router`. */
const openThread = async (
  router?: string,
  sender = ROUTER,
  {
    showEcho = true,
    voiceTs = 2_000,
    voiceAge = 0,
    echoBody = '🎤 Invented words',
    joinedMembers = [VIEWER, AGENT],
  } = {}
) => {
  if (router) setRouterBinding(router);
  const { RoomTimeline } = await import('../RoomTimeline');
  const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
  const events = [
    rootEvent,
    makeEvent('$voice', {
      threadRootId: threadId,
      ts: voiceTs,
      unsigned: { age: voiceAge },
      content: {
        msgtype: 'm.audio',
        body: 'voice.ogg',
        url: 'mxc://example.org/voice',
        'org.matrix.msc3245.voice': {},
      },
    }),
    makeEvent('$echo', {
      threadRootId: threadId,
      ts: 3_000,
      sender,
      content: {
        msgtype: 'm.text',
        body: echoBody,
        'com.mindroom.visible_router_voice_echo': true,
        'com.mindroom.voice_source_event_id': '$voice',
      },
    }),
  ];
  if (!showEcho) events.pop();
  const timeline = makeTimeline(events, { backwardToken: null });
  const timelineSet = { getLiveTimeline: () => timeline, getTimelineForEvent: () => undefined };
  const room = makeRoomWithState({ liveEvents: [rootEvent], joinedMembers });
  room.getThread = () =>
    ({
      rootEvent,
      events: events.slice(1),
      getUnfilteredTimelineSet: () => timelineSet,
    } as never);
  threadRenderStateMock.threadEvents = events;
  threadRenderStateMock.threadEventIndexMapRef.current = new Map(
    events.map((event, index) => [event.getId(), index])
  );
  roomTimelineVirtualizerState.virtualIndexes = events.map((_event, index) => index);
  const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
  let renderer: ReturnType<typeof create> | undefined;
  const element = () => React.createElement(Harness, { room, threadId });
  await act(async () => {
    renderer = create(element());
    await flushAsyncWork();
  });
  return { renderer: renderer!, room, update: () => renderer!.update(element()) };
};

const changeMembership = (joined: string[], userId: string, membership: 'join' | 'leave') => {
  const oldMembership = joined.includes(userId) ? 'join' : 'leave';
  if (membership === 'join') joined.push(userId);
  else joined.splice(joined.indexOf(userId), 1);
  const member = new RoomMember('!room:example.org', userId);
  const event = new MatrixEvent({
    type: 'm.room.member',
    room_id: member.roomId,
    state_key: userId,
    content: { membership },
  });
  member.setMembershipEvent(event);
  const listener = matrixClientMock.on.mock.calls.findLast(
    ([name]) => name === RoomMemberEvent.Membership
  )?.[1] as ((event: MatrixEvent, member: RoomMember, oldMembership: string) => void) | undefined;
  if (!listener) throw new Error('No membership listener');
  listener(event, member, oldMembership);
};

const transcripts = (renderer: ReturnType<typeof create>) =>
  renderer.root
    .findAll((node) => typeof node.props['data-voice-transcript'] === 'string')
    .map((node) => node.props['data-voice-transcript'] as string);

const transcribingStatuses = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAllByProps({ role: 'status', 'aria-label': 'Transcribing…' });

describe('a voice echo in an open thread', () => {
  it('folds under its voice message when the room names its sender as the router', async () => {
    const { renderer } = await openThread(ROUTER);
    try {
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$voice']);
      expect(transcripts(renderer)).toEqual(['🎤 Invented words']);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('folds a source-linked legacy placeholder into the voice row', async () => {
    const echoBody = 'Router agent is transcribing…';
    const { renderer } = await openThread(ROUTER, ROUTER, { echoBody });
    try {
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$voice']);
      expect(transcripts(renderer)).toEqual([echoBody]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([true, false])('folds a joined agent echo only when listed (%s)', async (listed) => {
    if (listed) setRoster([AGENT]);
    const { renderer } = await openThread(ROUTER, AGENT);
    try {
      expect(getRenderedEventIds(renderer)).toEqual(
        listed ? [threadId, '$voice'] : [threadId, '$voice', '$echo']
      );
      expect(transcripts(renderer)).toEqual(listed ? ['🎤 Invented words'] : []);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('folds a loaded echo when its roster sender joins and shows the row again on leave', async () => {
    const joinedMembers = [VIEWER];
    setRoster([CUSTOM_AGENT]);
    const { renderer } = await openThread(ROUTER, CUSTOM_AGENT, { joinedMembers });
    try {
      expect(getRenderedEventIds(renderer)).toContain('$echo');
      await act(async () => changeMembership(joinedMembers, CUSTOM_AGENT, 'join'));
      expect(getRenderedEventIds(renderer)).not.toContain('$echo');
      expect(transcripts(renderer)).toEqual(['🎤 Invented words']);
      await act(async () => changeMembership(joinedMembers, CUSTOM_AGENT, 'leave'));
      expect(getRenderedEventIds(renderer)).toContain('$echo');
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([
    ['binding', 'io.mindroom.router', ''],
    ['roster', 'io.mindroom.accounts', ROUTER],
  ])('shows a folded echo again when its %s is redacted in place', async (_case, type, key) => {
    setRoster([CUSTOM_AGENT]);
    const { renderer, room } = await openThread(ROUTER, CUSTOM_AGENT, {
      joinedMembers: [VIEWER, CUSTOM_AGENT],
    });
    try {
      expect(getRenderedEventIds(renderer)).not.toContain('$echo');
      const state = roomState.getStateEvents(type, key)!;
      const redaction = new MatrixEvent({ type: 'm.room.redaction', event_id: '$redaction' });
      act(() => {
        state.makeRedacted(redaction, room as unknown as Room);
        // The SDK emits the same object again when redacting current state.
        roomState.setStateEvents([state]);
      });
      expect(state.isRedacted()).toBe(true);
      expect(getRenderedEventIds(renderer)).toContain('$echo');
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('does not rebuild fold trust on an unrelated render', async () => {
    const { renderer, room, update } = await openThread(ROUTER);
    try {
      const getJoinedMembers = vi.spyOn(room, 'getJoinedMembers');
      act(update);
      // No membership read: no fresh own voice message asks for the hint, and fold trust holds.
      expect(getJoinedMembers).not.toHaveBeenCalled();
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('updates the fold when the bound roster changes without a membership change', async () => {
    const { renderer } = await openThread(ROUTER, CUSTOM_AGENT, {
      joinedMembers: [VIEWER, CUSTOM_AGENT],
    });
    try {
      expect(getRenderedEventIds(renderer)).toContain('$echo');
      act(() => setRoster([CUSTOM_AGENT]));
      expect(getRenderedEventIds(renderer)).not.toContain('$echo');
      act(() => setRoster([]));
      expect(getRenderedEventIds(renderer)).toContain('$echo');
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([
    ['only the owner', [ROUTER], false],
    ['a roster-backed responder with a custom ID', [CUSTOM_AGENT], true],
    ['a responder and another person', [AGENT, '@alex:example.org'], true],
  ] as const)('shows pending with %s only if somebody answers', async (_case, joined, pending) => {
    setRoster([CUSTOM_AGENT]);
    const { renderer } = await openThread(ROUTER, ROUTER, {
      showEcho: false,
      joinedMembers: [VIEWER, ...joined],
    });
    try {
      expect(transcribingStatuses(renderer)).toHaveLength(pending ? 1 : 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([
    ['names no router', undefined],
    ['names another account', '@mindroom_router_lab1:example.org'],
  ])('keeps its own row when the room %s', async (_case, router) => {
    const { renderer } = await openThread(router);
    try {
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$voice', '$echo']);
      expect(transcripts(renderer)).toEqual([]);
    } finally {
      act(() => renderer.unmount());
    }
  });
});

it('hides the transcribing skeleton 60 seconds after the voice message was sent', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const { renderer } = await openThread(undefined, AGENT, {
    showEcho: false,
    voiceTs: 3_700_000,
    voiceAge: 40_000,
  });
  const status = () => transcribingStatuses(renderer);
  try {
    expect(status()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(19_999);
    });
    expect(status()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(status()).toHaveLength(0);
  } finally {
    act(() => renderer.unmount());
    vi.useRealTimers();
  }
});

it('reschedules expiry if the clock moves back while the hint is pending', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const { renderer } = await openThread(undefined, AGENT, { showEcho: false, voiceAge: 40_000 });
  try {
    expect(transcribingStatuses(renderer)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(10_000);
      vi.setSystemTime(105_000);
      vi.advanceTimersByTime(10_000);
    });
    expect(transcribingStatuses(renderer)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(transcribingStatuses(renderer)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(transcribingStatuses(renderer)).toHaveLength(0);
  } finally {
    act(() => renderer.unmount());
    vi.useRealTimers();
  }
});

it('does not show pending for a voice root whose unloaded replies are bundled', async () => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const voice = makeEvent('$voice', {
    ts: Date.now(),
    isThreadRoot: true,
    unsigned: { age: 0, 'm.relations': { 'm.thread': { count: 1 } } },
    content: { msgtype: 'm.audio', body: 'voice.ogg', 'org.matrix.msc3245.voice': {} },
  });
  const room = makeRoomWithState({ liveEvents: [voice], joinedMembers: [VIEWER, AGENT] });
  const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
  let renderer: ReturnType<typeof create> | undefined;
  roomTimelineVirtualizerState.virtualIndexes = [0];
  await act(async () => {
    renderer = create(React.createElement(Harness, { room, initialViewMode: 'classic' }));
    await flushAsyncWork();
  });
  try {
    expect(room.getThread('$voice')).toBeNull();
    expect(getRenderedEventIds(renderer!)).toContain('$voice');
    expect(transcribingStatuses(renderer!)).toHaveLength(0);
  } finally {
    act(() => renderer?.unmount());
  }
});

describe("the router's voice echo in the room's timeline", () => {
  it('keeps its own row while its voice message is loaded but outside the rendered window', async () => {
    setRouterBinding(ROUTER);
    const voice = makeEvent('$voice', {
      ts: 1,
      content: {
        msgtype: 'm.audio',
        body: 'voice.ogg',
        url: 'mxc://example.org/voice',
        'org.matrix.msc3245.voice': {},
      },
    });
    // The window holds the newest 200 rows, so the voice message is loaded but not drawn.
    const filler = Array.from({ length: 250 }, (_, index) =>
      makeEvent(`$filler${index}`, { ts: index + 2 })
    );
    const echo = makeEvent('$echo', {
      ts: 300,
      sender: ROUTER,
      content: {
        msgtype: 'm.text',
        body: '🎤 Invented words',
        'com.mindroom.visible_router_voice_echo': true,
        'com.mindroom.voice_source_event_id': '$voice',
      },
    });
    const { RoomTimeline } = await import('../RoomTimeline');
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        wrapWithSyncEngine(
          React.createElement(RoomTimeline as never, {
            room: makeRoomWithState({ liveEvents: [voice, ...filler, echo] }),
            hasMindroomAgents: false,
            summaryMap: new Map(),
            onStoreThreadSummary: vi.fn(),
            threadFilterState: createDefaultThreadFilterState(),
            threadSortFreezeState: null,
            viewMode: 'classic',
            editor: {} as never,
          })
        )
      );
      await flushAsyncWork(2);
    });
    try {
      const ids = getRenderedEventIds(renderer!);
      expect(ids).not.toContain('$voice');
      expect(ids.at(-1)).toBe('$echo');
    } finally {
      act(() => renderer!.unmount());
    }
  });
});
