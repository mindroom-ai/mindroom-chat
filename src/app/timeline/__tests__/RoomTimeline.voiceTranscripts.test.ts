import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getRenderedEventIds,
  makeEvent,
  makeRoom,
  makeTimeline,
  roomTimelineVirtualizerState,
  powerLevelsContextMock,
  stateEventsByTypeMock,
  threadRenderStateMock,
  wrapWithSyncEngine,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const threadId = '$root';
const AGENT = '@mindroom_helper:example.org';
const ROUTER = '@mindroom_router:example.org';
const CUSTOM_AGENT = '@helper:example.org';
const VIEWER = '@alice:example.org';

const setRoster = (accounts: string[]) =>
  stateEventsByTypeMock.set('io.mindroom.accounts', [
    makeEvent('$accounts', {
      type: 'io.mindroom.accounts',
      stateKey: ROUTER,
      sender: ROUTER,
      content: { accounts },
    }),
  ] as never);

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
  if (router) {
    // The router bound itself and holds the level the binding takes.
    powerLevelsContextMock.levels = { users: { [router]: 50 } };
    stateEventsByTypeMock.set('io.mindroom.router', [
      makeEvent('$binding', { sender: router, content: { user_id: router } }),
    ] as never);
  }
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
  const room = makeRoom({ liveEvents: [rootEvent], joinedMembers });
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
  await act(async () => {
    renderer = create(React.createElement(Harness, { room, threadId }));
    await flushAsyncWork();
  });
  return renderer!;
};

const transcripts = (renderer: ReturnType<typeof create>) =>
  renderer.root
    .findAll((node) => typeof node.props['data-voice-transcript'] === 'string')
    .map((node) => node.props['data-voice-transcript'] as string);

const transcribingStatuses = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAllByProps({ role: 'status', 'aria-label': 'Transcribing…' });

describe('a voice echo in an open thread', () => {
  afterEach(() => {
    stateEventsByTypeMock.clear();
    powerLevelsContextMock.levels = {};
  });

  it('folds under its voice message when the room names its sender as the router', async () => {
    const renderer = await openThread(ROUTER);
    try {
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$voice']);
      expect(transcripts(renderer)).toEqual(['🎤 Invented words']);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('folds a source-linked legacy placeholder into the voice row', async () => {
    const echoBody = 'Router agent is transcribing…';
    const renderer = await openThread(ROUTER, ROUTER, { echoBody });
    try {
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$voice']);
      expect(transcripts(renderer)).toEqual([echoBody]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([true, false])('folds a joined agent echo only when listed (%s)', async (listed) => {
    if (listed) setRoster([AGENT]);
    const renderer = await openThread(ROUTER, AGENT);
    try {
      expect(getRenderedEventIds(renderer)).toEqual(
        listed ? [threadId, '$voice'] : [threadId, '$voice', '$echo']
      );
      expect(transcripts(renderer)).toEqual(listed ? ['🎤 Invented words'] : []);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([
    ['only the owner', [ROUTER], false],
    ['a roster-backed responder with a custom ID', [CUSTOM_AGENT], true],
  ] as const)('shows pending with %s only if somebody answers', async (_case, joined, pending) => {
    setRoster([CUSTOM_AGENT]);
    const renderer = await openThread(ROUTER, ROUTER, { showEcho: false, joinedMembers: [VIEWER, ...joined] });
    try {
      expect(transcribingStatuses(renderer)).toHaveLength(pending ? 1 : 0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('does not show pending in a room with another person', async () => {
    const renderer = await openThread(undefined, AGENT, {
      showEcho: false,
      joinedMembers: [VIEWER, '@alex:example.org', AGENT],
    });
    try {
      expect(transcribingStatuses(renderer)).toHaveLength(0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([
    ['names no router', undefined],
    ['names another account', '@mindroom_router_lab1:example.org'],
  ])('keeps its own row when the room %s', async (_case, router) => {
    const renderer = await openThread(router);
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
  const renderer = await openThread(undefined, AGENT, {
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

describe("the router's voice echo in the room's timeline", () => {
  afterEach(() => {
    stateEventsByTypeMock.clear();
    powerLevelsContextMock.levels = {};
  });

  it('keeps its own row while its voice message is loaded but outside the rendered window', async () => {
    powerLevelsContextMock.levels = { users: { [ROUTER]: 50 } };
    stateEventsByTypeMock.set('io.mindroom.router', [
      makeEvent('$binding', { sender: ROUTER, content: { user_id: ROUTER } }),
    ] as never);
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
            room: makeRoom({ liveEvents: [voice, ...filler, echo] }),
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
