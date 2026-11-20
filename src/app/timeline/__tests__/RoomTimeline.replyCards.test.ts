import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import {
  create,
  createControlledRoomTimelineHarness,
  flushAsyncWork,
  getRenderedEventIds,
  makeEvent,
  makeRoom,
  makeTimeline,
  powerLevelsContextMock,
  roomTimelineVirtualizerState,
  stateEventsByTypeMock,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { ChatUiActionContext } from '../../ui-actions/ChatUiActionProvider';
import type { ChatUiAction } from '../../matrix/protocol/chatUiProtocol';

const threadId = '$root';
const ROUTER = '@mindroom_router:example.org';
const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } };

importBeforeTests(() => import('../RoomTimeline'));

type Event = ReturnType<typeof makeEvent>;

/** The router's canvas notice answering `$ask`. */
const notice = () =>
  makeEvent('$canvas', {
    threadRootId: threadId,
    replyTo: '$ask',
    sender: ROUTER,
    ts: 5_000,
    content: {
      ...inThread,
      msgtype: 'm.notice',
      body: 'Interactive panel: Project Alpha KPIs.',
      'io.mindroom.ui_action': { version: 1, action: 'show_canvas' },
    },
  });

/** The router's ordinary text reply to `$ask`. */
const reply = (id = '$reply', ts = 3_000) =>
  makeEvent(id, {
    threadRootId: threadId,
    replyTo: '$ask',
    sender: ROUTER,
    ts,
    content: { ...inThread, msgtype: 'm.text', body: 'Here are the KPIs.' },
  });

/** `$ask` is a model change the router applied; this is its acknowledgement, a text reply too. */
const modelAck = () =>
  makeEvent('$ack', {
    threadRootId: threadId,
    replyTo: '$ask',
    sender: ROUTER,
    ts: 4_000,
    content: {
      ...inThread,
      msgtype: 'm.text',
      body: 'This thread now uses invented-swift@high.',
      'io.mindroom.model_selection_result': {
        version: 1,
        command_event_id: '$ask',
        room_id: '!room:example.org',
        thread_id: threadId,
        runtime_user_id: ROUTER,
        runtime_device_id: 'ROUTERDEVICE',
        operation: 'set',
        model: 'invented-swift@high',
        status: 'applied',
        override: 'invented-swift@high',
      },
    },
  });

/**
 * The thread `$root`, `$ask` (Alice's `!model invented-swift@high`) and `rows`, the room naming
 * `ROUTER` as its router. `opens` is whether this viewer's message buttons would open the canvas
 * (its agent still joined, say).
 */
const openThread = async (
  rows: Event[],
  { canvasEnabled = true, opens = true }: { canvasEnabled?: boolean; opens?: boolean } = {}
) => {
  powerLevelsContextMock.levels = { users: { [ROUTER]: 50 } };
  stateEventsByTypeMock.set('io.mindroom.router', [
    makeEvent('$binding', { sender: ROUTER, content: { user_id: ROUTER } }),
  ] as never);
  const { RoomTimeline } = await import('../RoomTimeline');
  const rootEvent = makeEvent(threadId, { isThreadRoot: true, ts: 1_000 });
  const ask = makeEvent('$ask', {
    threadRootId: threadId,
    ts: 2_000,
    content: { ...inThread, msgtype: 'm.text', body: '!model invented-swift@high' },
  });
  const events = [rootEvent, ask, ...rows];
  const timeline = makeTimeline(events, { backwardToken: null });
  const timelineSet = { getLiveTimeline: () => timeline, getTimelineForEvent: () => undefined };
  const room = makeRoom({ liveEvents: [rootEvent] });
  room.getThread = () =>
    ({ rootEvent, events: events.slice(1), getUnfilteredTimelineSet: () => timelineSet } as never);
  threadRenderStateMock.threadEvents = events;
  threadRenderStateMock.threadEventIndexMapRef.current = new Map(
    events.map((event, index) => [event.getId(), index])
  );
  roomTimelineVirtualizerState.virtualIndexes = events.map((_event, index) => index);
  const canvas = rows.find((event) => event.getId() === '$canvas');
  const action = {
    action: 'show_canvas',
    eventId: '$canvas',
    revisionEventId: '$canvas',
    canvas: { title: 'Project Alpha KPIs', html: '<p>KPIs</p>' },
    event: canvas,
  } as unknown as ChatUiAction;
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

/** The rows whose drawing holds the canvas card. */
const cardRows = (renderer: ReturnType<typeof create>) =>
  renderer.root
    .findAll(
      (node) => typeof node.type === 'string' && node.props.children === 'Project Alpha KPIs'
    )
    .map((node) => {
      let row = node.parent;
      while (row && typeof row.props['data-message-id'] !== 'string') row = row.parent;
      return row?.props['data-message-id'];
    });

const shows = async (rows: Event[], options?: Parameters<typeof openThread>[1]) => {
  const renderer = await openThread(rows, options);
  try {
    const ids = getRenderedEventIds(renderer);
    return { notice: ids.includes('$canvas'), cardIn: [...new Set(cardRows(renderer))] };
  } finally {
    act(() => renderer.unmount());
  }
};

describe("a canvas notice in an open thread, beside its agent's reply", () => {
  afterEach(() => {
    stateEventsByTypeMock.clear();
    powerLevelsContextMock.levels = {};
  });

  it('moves under the reply when its card can open', async () => {
    expect(await shows([reply(), notice()])).toEqual({ notice: false, cardIn: ['$reply'] });
  });

  it.each([
    ['with canvases turned off', { canvasEnabled: false }],
    ["when the viewer's buttons would not open it", { opens: false }],
  ])('keeps its row %s', async (_case, options) => {
    expect(await shows([reply(), notice()], options)).toEqual({ notice: true, cardIn: [] });
  });

  it("goes under the ordinary reply, not a later model change's acknowledgement", async () => {
    expect(await shows([reply(), modelAck(), notice()])).toEqual({
      notice: false,
      cardIn: ['$reply'],
    });
  });

  it("keeps its row when a model change's acknowledgement is the only reply", async () => {
    expect(await shows([modelAck(), notice()])).toEqual({ notice: true, cardIn: [] });
  });
});
