import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getRenderedEventIds,
  makeEvent,
  makeRoom,
  makeTimeline,
  roomTimelineVirtualizerState,
  stateEventsByTypeMock,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const threadId = '$root';
const ROUTER = '@mindroom_router:example.org';

// Its own test draws it; here only that the voice row shows it counts.
vi.mock('../../messages/content/VoiceTranscript', () => ({
  VoiceTranscript: ({ content }: { content: { body: string } }) =>
    React.createElement('p', { 'data-voice-transcript': content.body }),
}));

importBeforeTests(() => import('../RoomTimeline'));

/** A thread with a voice message and the router's echo of it, the room's state naming `router`. */
const openThread = async (router?: string) => {
  if (router) {
    stateEventsByTypeMock.set('io.mindroom.router', [
      makeEvent('$binding', { content: { user_id: router } }),
    ] as never);
  }
  const { RoomTimeline } = await import('../RoomTimeline');
  const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
  const events = [
    rootEvent,
    makeEvent('$voice', {
      threadRootId: threadId,
      ts: 2_000,
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
      sender: ROUTER,
      content: {
        msgtype: 'm.text',
        body: '🎤 Invented words',
        'com.mindroom.visible_router_voice_echo': true,
        'com.mindroom.voice_source_event_id': '$voice',
      },
    }),
  ];
  const timeline = makeTimeline(events, { backwardToken: null });
  const timelineSet = { getLiveTimeline: () => timeline, getTimelineForEvent: () => undefined };
  const room = makeRoom({ liveEvents: [rootEvent] });
  room.getThread = () =>
    ({
      rootEvent,
      events: events.slice(1),
      getUnfilteredTimelineSet: () => timelineSet,
    } as never);
  threadRenderStateMock.threadEvents = events as never;
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

describe("the router's voice echo in an open thread", () => {
  afterEach(() => stateEventsByTypeMock.clear());

  it('folds under its voice message when the room names its sender as the router', async () => {
    const renderer = await openThread(ROUTER);
    try {
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$voice']);
      expect(transcripts(renderer)).toEqual(['🎤 Invented words']);
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
