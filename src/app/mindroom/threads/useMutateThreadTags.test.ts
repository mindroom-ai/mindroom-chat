import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getPendingThreadTagsContent, resetPendingThreadTagsForTests } from './threadTagPending';
import { buildPerTagStateKey, MINDROOM_THREAD_TAGS_EVENT } from './threadTags';
import { getValidThreadRootEvent } from './threadUtils';
import { useMutateThreadTags } from './useMutateThreadTags';

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

const { threadUtilsMockState } = vi.hoisted(() => ({
  threadUtilsMockState: {
    defaultGetValidThreadRootEvent: undefined as
      | typeof import('./threadUtils').getValidThreadRootEvent
      | undefined,
  },
}));

vi.mock('./threadUtils', async () => {
  const actual = await vi.importActual<typeof import('./threadUtils')>('./threadUtils');
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

const makePerTagEvent = (
  threadRootId: string,
  tagName: string,
  content: Record<string, unknown>
) =>
  new MatrixEvent({
    content,
    event_id: `$per-tag-${threadRootId}-${tagName}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: buildPerTagStateKey(threadRootId, tagName),
    type: MINDROOM_THREAD_TAGS_EVENT,
  });

const makeRoom = (events: MatrixEvent[] = []) =>
  ({
    roomId: '!room:example.org',
    getThread: (threadId: string) =>
      threadId === '$root' ? ({ rootEvent: makeThreadRootEvent('$root') } as never) : undefined,
    findEventById: () => undefined,
    getLiveTimeline: () => ({
      getState: () => ({
        getStateEvents: (eventType: string) =>
          eventType === MINDROOM_THREAD_TAGS_EVENT ? events : [],
      }),
    }),
  }) as unknown as Room;

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
    resetPendingThreadTagsForTests();
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
    expect(getPendingThreadTagsContent('!room:example.org', '$root')).toEqual(
      {
        tags: {
          bug: {
            set_by: '@alice:example.org',
            set_at: ISO_1,
          },
        },
      }
    );

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
    expect(getPendingThreadTagsContent('!room:example.org', '$validated-root')).toEqual({
      tags: {
        bug: {
          set_by: '@alice:example.org',
          set_at: ISO_1,
        },
      },
    });
    expect(getPendingThreadTagsContent('!room:example.org', '$unvalidated-root')).toBeUndefined();

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
    expect(getPendingThreadTagsContent('!room:example.org', '$root')).toEqual({
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
    expect(getPendingThreadTagsContent('!room:example.org', '$root')).toEqual({
      tags: {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
        resolved: { set_by: '@alice:example.org', set_at: ISO_2 },
      },
    });

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
    expect(getPendingThreadTagsContent('!room:example.org', '$root')).toEqual({
      tags: {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
      },
    });

    renderer.unmount();
  });
});
