import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { EventTimeline } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  getPendingThreadTagRootIds,
  resetPendingThreadTagsForTests,
  withPendingThreadTags,
} from './threadTagPending';
import {
  aggregateThreadTagEvents,
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
} from '../../event-store/threads/threadTags';
import { getValidThreadRootEvent } from '../../event-store/threads/threadUtils';
import { useMutateThreadTags } from './useMutateThreadTags';

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

const { threadUtilsMockState } = vi.hoisted(() => ({
  threadUtilsMockState: {
    defaultGetValidThreadRootEvent: undefined as
      | typeof import('../../event-store/threads/threadUtils').getValidThreadRootEvent
      | undefined,
  },
}));

vi.mock('../../event-store/threads/threadUtils', async () => {
  const actual = await vi.importActual<typeof import('../../event-store/threads/threadUtils')>(
    '../../event-store/threads/threadUtils'
  );
  threadUtilsMockState.defaultGetValidThreadRootEvent = actual.getValidThreadRootEvent;
  return {
    ...actual,
    getValidThreadRootEvent: vi.fn(actual.getValidThreadRootEvent),
  };
});

const mockedUseMatrixClient = vi.mocked(useMatrixClient);
const mockedGetValidThreadRootEvent = vi.mocked(getValidThreadRootEvent);
const ISO_1 = '2026-04-07T00:00:01.000Z';
const ISO_2 = '2026-04-07T00:00:02.000Z';

type HarnessProps = {
  room: Room;
  onRender: (value: ReturnType<typeof useMutateThreadTags>) => void;
};

function Harness({ room, onRender }: HarnessProps) {
  onRender(useMutateThreadTags(room));
  return null;
}

const makeThreadRootEvent = (eventId: string) => {
  const event = new MatrixEvent({
    content: { body: 'Root', msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });
  Object.defineProperty(event, 'isThreadRoot', {
    value: true,
    configurable: true,
  });
  return event;
};

const makeStandaloneMessageEvent = (eventId: string) =>
  new MatrixEvent({
    content: { body: 'Standalone message', msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
  });

const makeLegacyThreadTagsEvent = (
  stateKey: string,
  tags: Record<string, Record<string, unknown>>
) =>
  new MatrixEvent({
    content: { tags },
    event_id: `$legacy-thread-tags-${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: stateKey,
    type: MINDROOM_THREAD_TAGS_EVENT,
  });

const makePerTagEvent = (threadRootId: string, tagName: string, content: Record<string, unknown>) =>
  new MatrixEvent({
    content,
    event_id: `$per-tag-${threadRootId}-${tagName}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: buildPerTagStateKey(threadRootId, tagName),
    type: MINDROOM_THREAD_TAGS_EVENT,
  });

const makeRoom = (events: MatrixEvent[] = [], eventsById: Record<string, MatrixEvent> = {}) =>
  ({
    roomId: '!room:example.org',
    getThread: (threadId: string) =>
      threadId === '$root' ? ({ rootEvent: makeThreadRootEvent('$root') } as never) : undefined,
    findEventById: (eventId: string) => eventsById[eventId],
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: string, stateKey?: string) =>
          eventType === MINDROOM_THREAD_TAGS_EVENT
            ? events
            : stateKey === undefined
            ? []
            : undefined,
      }),
    }),
  } as unknown as Room);

/** The thread's tags as shown: live tags with the pending writes on top; undefined without any. */
const pendingTags = (room: Room, threadRootId: string) => {
  if (!getPendingThreadTagRootIds(room.roomId).includes(threadRootId)) return undefined;
  const events =
    room
      .getLiveTimeline()
      .getState(EventTimeline.FORWARDS)
      ?.getStateEvents(MINDROOM_THREAD_TAGS_EVENT) ?? [];
  const live = aggregateThreadTagEvents(events).get(threadRootId) ?? { tags: {} };
  return withPendingThreadTags(room.roomId, threadRootId, live);
};

describe('useMutateThreadTags', () => {
  const sendStateEvent = vi.fn();

  beforeEach(() => {
    sendStateEvent.mockReset();
    sendStateEvent.mockResolvedValue(undefined);
    mockedGetValidThreadRootEvent.mockReset();
    mockedGetValidThreadRootEvent.mockImplementation(
      threadUtilsMockState.defaultGetValidThreadRootEvent!
    );
    mockedUseMatrixClient.mockReturnValue({
      getSafeUserId: () => '@alice:example.org',
      sendStateEvent,
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    resetPendingThreadTagsForTests();
  });

  it.each(['setResolved', 'addTag', 'setUnresolved', 'removeTag'] as const)(
    'blocks pinned resolution through %s',
    async (operation) => {
      const room = makeRoom();
      const readState = room.getLiveTimeline().getState;
      room.getLiveTimeline = () =>
        ({
          getState: () => ({
            ...readState(EventTimeline.FORWARDS),
            getStateEvents: (type: string, stateKey?: string) =>
              type === 'm.room.pinned_events'
                ? new MatrixEvent({ type, state_key: '', content: { pinned: ['$root'] } })
                : stateKey === undefined
                ? readState(EventTimeline.FORWARDS)?.getStateEvents(type)
                : readState(EventTimeline.FORWARDS)?.getStateEvents(type, stateKey),
          }),
        } as never);
      let snapshot!: ReturnType<typeof useMutateThreadTags>;
      const renderer = create(
        React.createElement(Harness, {
          room,
          onRender: (value) => {
            snapshot = value;
          },
        })
      );
      await act(async () => {
        if (operation === 'setResolved') await snapshot.setResolved('$root', true);
        else if (operation === 'setUnresolved') await snapshot.setResolved('$root', false);
        else if (operation === 'removeTag') await snapshot.removeTag('$root', 'resolved');
        else await snapshot.addTag('$root', 'resolved');
      });
      expect(sendStateEvent).not.toHaveBeenCalled();
      expect(pendingTags(room, '$root')).toBeUndefined();
      expect(snapshot.error).toBeInstanceOf(Error);
      renderer.unmount();
    }
  );

  it('allows another thread to resolve while suppressing duplicate writes to a pending thread', async () => {
    let finishFirst!: () => void;
    let rejectSecond!: (error: Error) => void;
    sendStateEvent
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectSecond = reject;
          })
      );
    const room = makeRoom([], { $second: makeThreadRootEvent('$second') });
    let snapshot!: ReturnType<typeof useMutateThreadTags>;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = snapshot.setResolved('$root', true);
      void snapshot.setResolved('$root', true);
      second = snapshot.setResolved('$second', true);
    });

    expect(sendStateEvent).toHaveBeenCalledTimes(2);
    expect(sendStateEvent.mock.calls.map((call) => call[3])).toEqual([
      '["$root","resolved"]',
      '["$second","resolved"]',
    ]);
    expect(snapshot.updatingThreadRootIds).toEqual(new Set(['$root', '$second']));

    await act(async () => {
      finishFirst();
      await first;
    });
    expect(snapshot.updating).toBe(true);
    expect(snapshot.updatingThreadRootIds).toEqual(new Set(['$second']));

    await act(async () => {
      rejectSecond(new Error('Save failed'));
      await second;
    });
    expect(snapshot.updating).toBe(false);
    expect(snapshot.updatingThreadRootIds.size).toBe(0);
    expect(pendingTags(room, '$second')).toBeUndefined();
    expect(pendingTags(room, '$root')?.tags.resolved).toBeDefined();

    await act(async () => {
      await snapshot.setResolved('$second', true);
    });
    expect(sendStateEvent).toHaveBeenCalledTimes(3);
    expect(snapshot.error).toBeNull();
    renderer.unmount();
  });

  it('writes new tags to canonical per-tag state keys and seeds aggregated pending state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_1));
    const room = makeRoom();

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.addTag('$root', 'bug');
    });

    expect(sendStateEvent).toHaveBeenCalledTimes(1);
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {
        set_by: '@alice:example.org',
        set_at: ISO_1,
      },
      '["$root","bug"]'
    );
    expect(pendingTags(room, '$root')).toEqual({
      tags: {
        bug: {
          set_by: '@alice:example.org',
          set_at: ISO_1,
        },
      },
    });

    renderer.unmount();
  });

  it('uses the validated thread root id for per-tag state keys and pending state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_1));
    const room = makeRoom();
    mockedGetValidThreadRootEvent.mockReturnValue(makeThreadRootEvent('$validated-root'));

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.addTag('$unvalidated-root', 'bug');
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {
        set_by: '@alice:example.org',
        set_at: ISO_1,
      },
      '["$validated-root","bug"]'
    );
    expect(pendingTags(room, '$validated-root')).toEqual({
      tags: {
        bug: {
          set_by: '@alice:example.org',
          set_at: ISO_1,
        },
      },
    });
    expect(pendingTags(room, '$unvalidated-root')).toBeUndefined();

    renderer.unmount();
  });

  it('removes a tag by sending a per-tag tombstone and preserving other merged tags in pending state', async () => {
    const room = makeRoom([
      makeLegacyThreadTagsEvent('$root', {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
      }),
      makePerTagEvent('$root', 'feature', {
        set_by: '@alice:example.org',
        set_at: ISO_2,
      }),
    ]);

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.removeTag('$root', 'feature');
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      '["$root","feature"]'
    );
    expect(pendingTags(room, '$root')).toEqual({
      tags: {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
      },
    });

    renderer.unmount();
  });

  it('writes resolved as a normal canonical per-tag record', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_2));
    const room = makeRoom([
      makeLegacyThreadTagsEvent('$root', {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
      }),
    ]);

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.setResolved('$root', true);
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {
        set_by: '@alice:example.org',
        set_at: ISO_2,
      },
      '["$root","resolved"]'
    );
    expect(pendingTags(room, '$root')).toEqual({
      tags: {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
        resolved: { set_by: '@alice:example.org', set_at: ISO_2 },
      },
    });

    renderer.unmount();
  });

  it('resolves a standalone zero-reply root without requiring an SDK thread model', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_2));
    const room = makeRoom([], {
      $standalone: makeStandaloneMessageEvent('$standalone'),
    });

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.setResolved('$standalone', true);
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {
        set_by: '@alice:example.org',
        set_at: ISO_2,
      },
      '["$standalone","resolved"]'
    );
    expect(pendingTags(room, '$standalone')).toEqual({
      tags: {
        resolved: { set_by: '@alice:example.org', set_at: ISO_2 },
      },
    });

    renderer.unmount();
  });

  it('adds tags to confirmed standalone roots shown in the compact view', async () => {
    const room = makeRoom([], {
      $standalone: makeStandaloneMessageEvent('$standalone'),
    });

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.addTag('$standalone', 'triage');
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      expect.objectContaining({ set_by: '@alice:example.org' }),
      '["$standalone","triage"]'
    );
    expect(snapshot?.error).toBeNull();

    renderer.unmount();
  });

  it('unresolves by writing a per-tag tombstone', async () => {
    const room = makeRoom([
      makeLegacyThreadTagsEvent('$root', {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
      }),
      makePerTagEvent('$root', 'resolved', {
        set_by: '@alice:example.org',
        set_at: ISO_2,
      }),
    ]);

    let snapshot: ReturnType<typeof useMutateThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    await act(async () => {
      await snapshot?.setResolved('$root', false);
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      '["$root","resolved"]'
    );
    expect(pendingTags(room, '$root')).toEqual({
      tags: {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
      },
    });

    renderer.unmount();
  });
  const renderHarness = (room: Room) => {
    let snapshot!: ReturnType<typeof useMutateThreadTags>;
    const renderer = create(
      React.createElement(Harness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );
    return { renderer, current: () => snapshot };
  };

  it('snooze sends the tag with until in UTC and a note', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_1));
    const room = makeRoom();
    const { renderer, current } = renderHarness(room);

    let written: boolean | undefined;
    await act(async () => {
      written = await current().snooze('$root', new Date('2026-11-14T09:00:00+01:00'), 'check CI');
    });
    expect(written).toBe(true);

    const content = {
      set_by: '@alice:example.org',
      set_at: ISO_1,
      note: 'check CI',
      data: { until: '2026-11-14T08:00:00.000Z' },
    };
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      content,
      '["$root","snoozed"]'
    );
    expect(pendingTags(room, '$root')).toEqual({ tags: { snoozed: content } });
    expect(current().error).toBeNull();
    renderer.unmount();
  });

  it('snooze leaves out an empty note', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_1));
    const { renderer, current } = renderHarness(makeRoom());

    await act(async () => {
      await current().snooze('$root', new Date('2026-11-14T08:00:00Z'));
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      { set_by: '@alice:example.org', set_at: ISO_1, data: { until: '2026-11-14T08:00:00.000Z' } },
      '["$root","snoozed"]'
    );
    renderer.unmount();
  });

  it('unsnooze sends empty content', async () => {
    const room = makeRoom([
      makePerTagEvent('$root', 'snoozed', {
        set_by: '@alice:example.org',
        set_at: ISO_1,
        data: { until: '2099-01-01T00:00:00Z' },
      }),
    ]);
    const { renderer, current } = renderHarness(room);

    await act(async () => {
      await current().unsnooze('$root');
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      '["$root","snoozed"]'
    );
    expect(pendingTags(room, '$root')).toEqual({ tags: {} });
    renderer.unmount();
  });

  it('refuses a past time and a pinned thread', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ISO_2));
    const room = makeRoom();
    const { renderer, current } = renderHarness(room);

    let written: boolean | undefined;
    await act(async () => {
      written = await current().snooze('$root', new Date(ISO_2));
    });
    expect(written).toBe(false);
    expect(current().error?.message).toBe('Snooze time must be in the future.');
    await act(async () => {
      await current().snooze('$root', new Date(Number.NaN));
    });
    expect(current().error?.message).toBe('Snooze time must be in the future.');
    expect(sendStateEvent).not.toHaveBeenCalled();
    renderer.unmount();

    const readState = room.getLiveTimeline().getState;
    room.getLiveTimeline = () =>
      ({
        getState: () => ({
          ...readState(EventTimeline.FORWARDS),
          getStateEvents: (type: string, stateKey?: string) =>
            type === 'm.room.pinned_events'
              ? new MatrixEvent({ type, state_key: '', content: { pinned: ['$root'] } })
              : stateKey === undefined
              ? readState(EventTimeline.FORWARDS)?.getStateEvents(type)
              : readState(EventTimeline.FORWARDS)?.getStateEvents(type, stateKey),
        }),
      } as never);
    const pinned = renderHarness(room);
    await act(async () => {
      written = await pinned.current().snooze('$root', new Date('2026-11-14T08:00:00Z'));
    });
    expect(written).toBe(false);
    expect(pinned.current().error?.message).toBe('Pinned threads cannot be snoozed.');
    expect(sendStateEvent).not.toHaveBeenCalled();
    expect(pendingTags(room, '$root')).toBeUndefined();

    // A snooze set before the pin can still be lifted.
    await act(async () => {
      await pinned.current().unsnooze('$root');
    });
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      '["$root","snoozed"]'
    );
    pinned.renderer.unmount();
  });
});
