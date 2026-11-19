import React from 'react';
import { MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
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
  pluginRowHiddenMock,
  roomTimelineVirtualizerState,
  powerLevelsContextMock,
  stateEventsByTypeMock,
  threadRenderStateMock,
} from '../test-utils/RoomTimeline.test.shared';
import { importBeforeTests } from '../../../test/utils/importBeforeTests';

const threadId = '$root';
const ROOM_ID = '!room:example.org';
const ROUTER = '@mindroom_router:example.org';

// Its own test draws it; here only which row shows it, and for which change, counts.
vi.mock('../../messages/ModelChangeMarker', () => ({
  ModelChangeMarker: ({ change }: { change: { operation: string; model?: string } }) =>
    React.createElement('p', {
      'data-model-change': `${change.operation}:${change.model ?? ''}`,
    }),
}));

importBeforeTests(() => import('../RoomTimeline'));

const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: threadId } };

const result = (commandId: string, fields: Record<string, unknown>) => ({
  version: 1,
  command_event_id: commandId,
  room_id: ROOM_ID,
  thread_id: threadId,
  runtime_user_id: ROUTER,
  runtime_device_id: 'ROUTERDEVICE',
  ...fields,
});

/**
 * A thread where a person set a model from the picker (`$set`), reset it by typing (`$reset`) and
 * asked for a model nobody has (`$unknown`), each answered by `ROUTER`; the room's state names
 * `router` as its router. `forkAt` names a message of the thread another thread was forked at,
 * and `setEdit` is an edit of `$set` that has not decrypted yet.
 */
const openThread = async (router?: string, forkAt?: string, setEdit?: MatrixEvent) => {
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
    makeEvent('$set', {
      threadRootId: threadId,
      ts: 2_000,
      content: {
        ...inThread,
        msgtype: 'm.text',
        body: '!model invented-swift@high',
        'io.mindroom.model_selection': {
          version: 1,
          runtime_user_id: ROUTER,
          runtime_device_id: 'ROUTERDEVICE',
          operation: 'set',
          model: 'invented-swift@high',
        },
      },
    }),
    makeEvent('$set-ack', {
      threadRootId: threadId,
      ts: 3_000,
      sender: ROUTER,
      content: {
        ...inThread,
        msgtype: 'm.notice',
        body: 'This thread now uses invented-swift@high.',
        'io.mindroom.model_selection_result': result('$set', {
          operation: 'set',
          model: 'invented-swift@high',
          status: 'applied',
          override: 'invented-swift@high',
        }),
      },
    }),
    makeEvent('$reset', {
      threadRootId: threadId,
      ts: 4_000,
      content: { ...inThread, msgtype: 'm.text', body: '!model reset' },
    }),
    makeEvent('$reset-ack', {
      threadRootId: threadId,
      ts: 5_000,
      sender: ROUTER,
      content: {
        ...inThread,
        msgtype: 'm.notice',
        body: 'Thread override cleared.',
        'io.mindroom.model_selection_result': result('$reset', {
          operation: 'reset',
          status: 'applied',
          override: null,
        }),
      },
    }),
    makeEvent('$unknown', {
      threadRootId: threadId,
      ts: 6_000,
      content: { ...inThread, msgtype: 'm.text', body: '!model invented-missing' },
    }),
    makeEvent('$unknown-ack', {
      threadRootId: threadId,
      ts: 7_000,
      sender: ROUTER,
      content: {
        ...inThread,
        msgtype: 'm.notice',
        body: 'Unknown model.',
        'io.mindroom.model_selection_result': result('$unknown', {
          operation: 'set',
          model: 'invented-missing',
          status: 'rejected',
          error: 'unknown_model',
        }),
      },
    }),
  ];
  if (setEdit) Object.assign(events[1]!, { __pendingEdits: [setEdit] });
  const timeline = makeTimeline(events, { backwardToken: null });
  const timelineSet = { getLiveTimeline: () => timeline, getTimelineForEvent: () => undefined };
  const fork = makeEvent('$fork', {
    ts: 8_000,
    content: { body: 'fork', 'io.mindroom.fork': { thread_id: threadId, event_id: forkAt } },
  });
  const room = makeRoom({ liveEvents: forkAt ? [rootEvent, fork] : [rootEvent] });
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

/** Each drawn line as `[row, change]`: the row is the acknowledgement's. */
const lines = (renderer: ReturnType<typeof create>) =>
  renderer.root
    .findAll((node) => typeof node.props['data-model-change'] === 'string')
    .map((node) => {
      let row = node.parent;
      while (row && typeof row.props['data-message-id'] !== 'string') row = row.parent;
      return [row?.props['data-message-id'], node.props['data-model-change']];
    });

describe("a thread's model changes in the open thread", () => {
  afterEach(() => {
    stateEventsByTypeMock.clear();
    powerLevelsContextMock.levels = {};
    pluginRowHiddenMock.test = undefined;
  });

  it('draws each applied change as one line at its acknowledgement and hides its command', async () => {
    const renderer = await openThread(ROUTER);
    try {
      expect(getRenderedEventIds(renderer)).toEqual([
        threadId,
        '$set-ack',
        '$reset-ack',
        '$unknown',
        '$unknown-ack',
      ]);
      expect(lines(renderer)).toEqual([
        ['$set-ack', 'set:invented-swift@high'],
        ['$reset-ack', 'reset:'],
      ]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('keeps the command of an acknowledgement a plugin hides, as it shows without the line', async () => {
    pluginRowHiddenMock.test = (event) => event.eventId === '$set-ack';
    const renderer = await openThread(ROUTER);
    try {
      expect(getRenderedEventIds(renderer)).toEqual([
        threadId,
        '$set',
        '$reset-ack',
        '$unknown',
        '$unknown-ack',
      ]);
      expect(lines(renderer)).toEqual([['$reset-ack', 'reset:']]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it('gives a command its row back when an edit of it decrypts into another message', async () => {
    const edit = new MatrixEvent({ event_id: '$set-edit', type: 'm.room.encrypted', content: {} });
    const renderer = await openThread(ROUTER, undefined, edit);
    try {
      expect(lines(renderer)).toHaveLength(2);
      // The edit decrypts after the timeline change that brought it: only its own event says so.
      Object.assign(threadRenderStateMock.threadEvents[1] as object, {
        __pendingEdits: [],
        __editedEvent: makeEvent('$set-edit', { content: { body: 'never mind' } }),
      });
      await act(async () => {
        edit.emit(MatrixEventEvent.Decrypted, edit);
        await flushAsyncWork();
      });
      expect(getRenderedEventIds(renderer)).toEqual([
        threadId,
        '$set',
        '$set-ack',
        '$reset-ack',
        '$unknown',
        '$unknown-ack',
      ]);
      expect(lines(renderer)).toEqual([['$reset-ack', 'reset:']]);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each(['$set', '$set-ack'])(
    'keeps both messages of a change when a thread was forked at %s, whose row links to the fork',
    async (forkAt) => {
      const renderer = await openThread(ROUTER, forkAt);
      try {
        expect(getRenderedEventIds(renderer)).toEqual([
          threadId,
          '$set',
          '$set-ack',
          '$reset-ack',
          '$unknown',
          '$unknown-ack',
        ]);
        expect(lines(renderer)).toEqual([['$reset-ack', 'reset:']]);
      } finally {
        act(() => renderer.unmount());
      }
    }
  );

  it.each([
    ['names no router', undefined],
    ['names another account', '@mindroom_router_lab1:example.org'],
  ])('keeps every command and reply as a message when the room %s', async (_case, router) => {
    const renderer = await openThread(router);
    try {
      expect(getRenderedEventIds(renderer)).toEqual([
        threadId,
        '$set',
        '$set-ack',
        '$reset',
        '$reset-ack',
        '$unknown',
        '$unknown-ack',
      ]);
      expect(lines(renderer)).toEqual([]);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
