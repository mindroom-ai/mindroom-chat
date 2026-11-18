import React, { useState } from 'react';
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
  messageContentMock,
  roomTimelineVirtualizerState,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';
import { useSecretRequestLine } from '../../messages/inlineSecretRequests';

const threadId = '$root';
const AGENT = '@mindroom_dev:example.org';

importBeforeTests(() => import('../RoomTimeline'));

/** The reply's body, which mounts the card's line while the test says so (`line.show`). */
const line = { show: (_shown: boolean) => {} };
function ReplyBody() {
  const [shown, setShown] = useState(false);
  line.show = setShown;
  const { line: mounted } = useSecretRequestLine('$card', shown);
  return mounted ? React.createElement('mock-secret-line') : null;
}

const row = (id: string, ts: number, sender?: string) =>
  makeEvent(id, { threadRootId: threadId, ts, sender });

/**
 * A thread with an agent's reply and the done secret request card of one of its tool calls, which
 * comes after the rows `between` and before the rows `after`.
 */
const openThread = async (
  between = [] as ReturnType<typeof row>[],
  after = [row('$after', 5_000)]
) => {
  const { RoomTimeline } = await import('../RoomTimeline');
  const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
  const events = [
    rootEvent,
    makeEvent('$reply', { threadRootId: threadId, ts: 2_000, sender: AGENT }),
    ...between,
    makeEvent('$card', {
      threadRootId: threadId,
      ts: 3_000,
      sender: AGENT,
      content: {
        msgtype: 'm.notice',
        body: 'Secret needed',
        'io.mindroom.secret_request': {
          request_id: 'req-1',
          requester_id: '@alice:example.org',
          env: 'EXAMPLE_TOKEN',
          keep: { memory: 900 },
          kept: 'memory',
          reason: 'To deploy the demo app',
          status: 'saved',
          expires_at: 4_000,
          response_event_id: '$reply',
          tool_call_id: 'call_1',
        },
      },
    }),
    ...after,
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
  messageContentMock.render = (eventId) =>
    eventId === '$reply' ? React.createElement(ReplyBody) : null;
  const Harness = createControlledRoomTimelineHarness(RoomTimeline as never);
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(React.createElement(Harness, { room, threadId }));
    await flushAsyncWork();
  });
  // The mocked virtual list shows a row's new size from the next render on.
  const settle = () =>
    act(async () => {
      renderer!.update(React.createElement(Harness, { room, threadId }));
      await flushAsyncWork();
    });
  return Object.assign(renderer!, { settle });
};

/** The size the virtual list gives the tile of row `index`. */
const sizeOfRow = (renderer: ReturnType<typeof create>, index: number) =>
  renderer.root.find((node) => node.props['data-virtual-index'] === index).props[
    'data-virtual-size'
  ];
const lines = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAll((node) => node.type === ('mock-secret-line' as never)).length;
const turnBreaks = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAll((node) => node.props['data-turn-break'] !== undefined).length;

describe("a done secret request card's row in an open thread", () => {
  it('takes no place while the reply has its line mounted, and its place again after', async () => {
    const renderer = await openThread();
    try {
      // The plan lets the reply draw it, and the reply shows no line: the card is a row.
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$reply', '$card', '$after']);
      expect(sizeOfRow(renderer, 2)).toBeGreaterThan(0);

      act(() => line.show(true));
      expect(lines(renderer)).toBe(1);
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$reply', '$after']);
      await renderer.settle();
      expect(sizeOfRow(renderer, 2)).toBe(0);

      act(() => line.show(false));
      expect(lines(renderer)).toBe(0);
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$reply', '$card', '$after']);
      await renderer.settle();
      expect(sizeOfRow(renderer, 2)).toBeGreaterThan(0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it("keeps the next turn's break, and room for it, while the reply draws the card", async () => {
    // The card came after the next message: it is the first row of that turn's fold, and draws
    // the turn's break.
    const renderer = await openThread(
      [row('$next', 2_500)],
      [row('$work', 5_000, AGENT), row('$answer', 6_000, AGENT)]
    );
    try {
      expect(turnBreaks(renderer)).toBe(1);
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$reply', '$next', '$answer']);

      act(() => line.show(true));
      await renderer.settle();

      expect(lines(renderer)).toBe(1);
      expect(turnBreaks(renderer)).toBe(1);
      expect(sizeOfRow(renderer, 3)).toBeGreaterThan(0);
      expect(getRenderedEventIds(renderer)).toEqual([threadId, '$reply', '$next', '$answer']);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
