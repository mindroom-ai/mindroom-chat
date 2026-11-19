import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getRenderedEventIds,
  makeEvent,
  makeRoom,
  makeTimeline,
  roomTimelineVirtualizerState,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { ChatUiActionContext } from '../../ui-actions/ChatUiActionProvider';
import type { ChatUiAction } from '../../matrix/protocol/chatUiProtocol';

const threadId = '$root';
const HELPER = '@mindroom_helper:example.org';

importBeforeTests(() => import('../RoomTimeline'));

/**
 * A thread where the Helper's reply and its canvas notice answer Alice's message. `opens` is
 * whether this viewer's message buttons would open the canvas (its agent still joined, say).
 */
const openThread = async ({ canvasEnabled, opens }: { canvasEnabled: boolean; opens: boolean }) => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
  const notice = makeEvent('$canvas', {
    threadRootId: threadId,
    replyTo: '$ask',
    sender: HELPER,
    ts: 3_000,
    content: {
      msgtype: 'm.notice',
      body: 'Interactive panel: Project Alpha KPIs.',
      'io.mindroom.ui_action': { version: 1, action: 'show_canvas' },
    },
  });
  const events = [
    rootEvent,
    makeEvent('$ask', { threadRootId: threadId, ts: 2_000 }),
    notice,
    makeEvent('$reply', {
      threadRootId: threadId,
      replyTo: '$ask',
      sender: HELPER,
      ts: 4_000,
      content: { msgtype: 'm.text', body: 'Here are the KPIs.' },
    }),
  ];
  const timeline = makeTimeline(events, { backwardToken: null });
  const timelineSet = { getLiveTimeline: () => timeline, getTimelineForEvent: () => undefined };
  const room = makeRoom({ liveEvents: [rootEvent] });
  room.getThread = () =>
    ({ rootEvent, events: events.slice(1), getUnfilteredTimelineSet: () => timelineSet } as never);
  threadRenderStateMock.threadEvents = events as never;
  threadRenderStateMock.threadEventIndexMapRef.current = new Map(
    events.map((event, index) => [event.getId(), index])
  );
  roomTimelineVirtualizerState.virtualIndexes = events.map((_event, index) => index);
  const action = {
    action: 'show_canvas',
    eventId: '$canvas',
    revisionEventId: '$canvas',
    canvas: { title: 'Project Alpha KPIs', html: '<p>KPIs</p>' },
    event: notice,
  } as ChatUiAction;
  const actions = {
    read: () => (opens ? action : undefined),
    unavailable: () => undefined,
    activate: () => undefined,
  };
  const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(
      React.createElement(
        ClientConfigProvider,
        { value: { mindroom: { canvas: { enabled: canvasEnabled } } } },
        React.createElement(
          ChatUiActionContext.Provider,
          { value: actions },
          React.createElement(Harness, { room, threadId })
        )
      )
    );
    await flushAsyncWork();
  });
  return renderer!;
};

describe("a canvas notice in an open thread, beside its agent's reply", () => {
  it.each([
    ['moves under the reply when its card can open', true, true, false],
    ['keeps its row with canvases turned off', false, true, true],
    ["keeps its row when the viewer's buttons would not open it", true, false, true],
  ])('%s', async (_case, canvasEnabled, opens, noticeShown) => {
    const renderer = await openThread({ canvasEnabled, opens });
    try {
      expect(getRenderedEventIds(renderer).includes('$canvas')).toBe(noticeShown);
      expect(getRenderedEventIds(renderer)).toContain('$reply');
    } finally {
      act(() => renderer.unmount());
    }
  });
});
