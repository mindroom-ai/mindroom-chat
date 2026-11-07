import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { createClient, Room } from 'matrix-js-sdk';
import { useStateEvents } from '../../matrix/hooks/useStateEvents';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { usePowerLevelsContext } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import {
  getPendingThreadTagRootIds,
  resetPendingThreadTagsForTests,
  setPendingThreadTag,
} from './threadTagPending';
import { buildPerTagStateKey, MINDROOM_THREAD_TAGS_EVENT } from '../../event-store/threads/threadTags';
import { useThreadTags } from './useThreadTags';
import { useMutateThreadTags } from './useMutateThreadTags';

vi.mock('../../matrix/hooks/useStateEvents', () => ({
  useStateEvents: vi.fn(),
}));

vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

vi.mock('../../matrix/hooks/usePowerLevels', () => ({
  usePowerLevelsContext: vi.fn(),
}));

vi.mock('../../matrix/hooks/useRoomCreators', () => ({
  useRoomCreators: vi.fn(),
}));

vi.mock('../../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: vi.fn(),
}));

const mockedUseStateEvents = vi.mocked(useStateEvents);
const makeRoom = () =>
  new Room(
    '!room:example.org',
    createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' }),
    '@alice:example.org'
  );
const mockedUseMatrixClient = vi.mocked(useMatrixClient);
const mockedUsePowerLevelsContext = vi.mocked(usePowerLevelsContext);
const mockedUseRoomCreators = vi.mocked(useRoomCreators);
const mockedUseRoomPermissions = vi.mocked(useRoomPermissions);
const ISO_1 = '2026-04-07T00:00:01.000Z';
const ISO_2 = '2026-04-07T00:00:02.000Z';
const ISO_3 = '2026-04-07T00:00:03.000Z';

type HarnessProps = {
  room: Room;
  threadRootId?: string;
  onRender: (value: ReturnType<typeof useThreadTags>) => void;
};

function Harness({ room, threadRootId, onRender }: HarnessProps) {
  onRender(useThreadTags(room, threadRootId));
  return null;
}

const makeLegacyTagEvent = (stateKey: string, tags: Record<string, Record<string, unknown>>) =>
  new MatrixEvent({
    content: {
      tags,
    },
    event_id: `$thread-tags-${stateKey}`,
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
    // The person a tag names sent it.
    sender: typeof content.set_by === 'string' ? content.set_by : '@alice:example.org',
    state_key: buildPerTagStateKey(threadRootId, tagName),
    type: MINDROOM_THREAD_TAGS_EVENT,
  });

const makePerTagTombstoneEvent = (threadRootId: string, tagName: string) =>
  makePerTagEvent(threadRootId, tagName, {});

describe('useThreadTags', () => {
  beforeEach(() => {
    mockedUseStateEvents.mockReturnValue([]);
    mockedUseMatrixClient.mockReturnValue({
      getSafeUserId: () => '@alice:example.org',
    } as never);
    mockedUsePowerLevelsContext.mockReturnValue(undefined as never);
    mockedUseRoomCreators.mockReturnValue([] as never);
    mockedUseRoomPermissions.mockReturnValue({
      stateEvent: () => true,
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetPendingThreadTagsForTests();
  });

  it('surfaces pending custom tags before the state event sync arrives', () => {
    const room = makeRoom();
    setPendingThreadTag(room.roomId, '$root', 'bug', {
      set_by: '@alice:example.org',
      set_at: ISO_1,
    });

    let snapshot: ReturnType<typeof useThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        threadRootId: '$root',
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    expect(snapshot?.displayTags).toEqual(['bug']);
    expect(snapshot?.tags).toEqual({
      bug: { set_by: '@alice:example.org', set_at: ISO_1 },
    });
    expect(snapshot?.isResolved).toBe(false);

    renderer.unmount();
  });

  it('aggregates per-tag room state for display, resolved status, and suggestions', () => {
    const room = makeRoom();
    mockedUseStateEvents.mockReturnValue([
      makePerTagEvent('$root', 'resolved', {
        set_by: '@alice:example.org',
        set_at: ISO_1,
      }),
      makePerTagEvent('$root', 'bug', {
        set_by: '@alice:example.org',
        set_at: ISO_2,
      }),
      makePerTagEvent('$other', 'feature', {
        set_by: '@bob:example.org',
        set_at: ISO_3,
      }),
    ]);

    let snapshot: ReturnType<typeof useThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        threadRootId: '$root',
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    expect(snapshot?.tags).toEqual({
      bug: { set_by: '@alice:example.org', set_at: ISO_2 },
      resolved: { set_by: '@alice:example.org', set_at: ISO_1 },
    });
    expect(snapshot?.displayTags).toEqual(['bug']);
    expect(snapshot?.isResolved).toBe(true);
    expect(snapshot?.availableTags).toEqual(['feature']);

    renderer.unmount();
  });

  it('merges legacy and per-tag room state, with tombstones overriding legacy tags', () => {
    const room = makeRoom();
    mockedUseStateEvents.mockReturnValue([
      makeLegacyTagEvent('$root', {
        bug: { set_by: '@alice:example.org', set_at: ISO_1 },
        resolved: { set_by: '@alice:example.org', set_at: ISO_2 },
      }),
      makePerTagEvent('$root', 'bug', {
        set_by: '@bob:example.org',
        set_at: ISO_3,
      }),
      makePerTagTombstoneEvent('$root', 'resolved'),
      makePerTagEvent('$other', 'feature', {
        set_by: '@carol:example.org',
        set_at: ISO_2,
      }),
    ]);

    let snapshot: ReturnType<typeof useThreadTags> | undefined;
    const renderer = create(
      React.createElement(Harness, {
        room,
        threadRootId: '$root',
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    expect(snapshot?.tags).toEqual({
      bug: { set_by: '@bob:example.org', set_at: ISO_3 },
    });
    expect(snapshot?.displayTags).toEqual(['bug']);
    expect(snapshot?.isResolved).toBe(false);
    expect(snapshot?.availableTags).toEqual(['feature']);

    renderer.unmount();
  });

  it('clears the pending custom tag once the aggregated live state matches it', () => {
    const room = makeRoom();
    mockedUseStateEvents.mockReturnValue([
      makePerTagEvent('$root', 'bug', {
        set_by: '@alice:example.org',
        set_at: ISO_1,
      }),
    ]);

    setPendingThreadTag(room.roomId, '$root', 'bug', {
      set_by: '@alice:example.org',
      set_at: ISO_1,
    });

    let snapshot: ReturnType<typeof useThreadTags> | undefined;
    let renderer: ReturnType<typeof create> | undefined;

    act(() => {
      renderer = create(
        React.createElement(Harness, {
          room,
          threadRootId: '$root',
          onRender: (value) => {
            snapshot = value;
          },
        })
      );
    });

    expect(snapshot?.displayTags).toEqual(['bug']);
    expect(getPendingThreadTagRootIds(room.roomId)).toEqual([]);

    renderer?.unmount();
  });

  it("shows another person's tag that syncs while this client's own tag is pending", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(ISO_1));
    const room = makeRoom();
    const root = new MatrixEvent({
      content: { body: 'Root', msgtype: 'm.text' },
      event_id: '$root',
      origin_server_ts: 1,
      room_id: room.roomId,
      sender: '@alice:example.org',
      type: 'm.room.message',
    });
    Object.defineProperty(root, 'isThreadRoot', { value: true });
    vi.spyOn(room, 'findEventById').mockReturnValue(root);
    // The write stays in flight, so only sync can settle the tag.
    const sendStateEvent = vi.fn(() => new Promise(() => undefined));
    mockedUseMatrixClient.mockReturnValue({
      getSafeUserId: () => '@alice:example.org',
      sendStateEvent,
    } as never);
    let mutate: ReturnType<typeof useMutateThreadTags> | undefined;
    let snapshot: ReturnType<typeof useThreadTags> | undefined;
    function Both() {
      mutate = useMutateThreadTags(room);
      snapshot = useThreadTags(room, '$root');
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(React.createElement(Both));
    });
    const sync = (events: MatrixEvent[]) => {
      mockedUseStateEvents.mockReturnValue(events);
      act(() => renderer.update(React.createElement(Both)));
    };
    const bobsTag = makePerTagEvent('$root', 'y-tab', {
      set_by: '@bob:example.org',
      set_at: ISO_2,
    });
    try {
      act(() => {
        void mutate?.addTag('$root', 'x-desk');
      });
      expect(sendStateEvent).toHaveBeenCalledTimes(1);
      expect(snapshot?.displayTags).toEqual(['x-desk']);

      sync([bobsTag]);
      expect(snapshot?.displayTags).toEqual(['x-desk', 'y-tab']);

      sync([bobsTag, makePerTagEvent('$root', 'x-desk', { set_by: '@alice:example.org', set_at: ISO_1 })]);
      expect(snapshot?.displayTags).toEqual(['x-desk', 'y-tab']);

      // The own tag has settled, so a later removal by someone else shows at once.
      sync([bobsTag, makePerTagTombstoneEvent('$root', 'x-desk')]);
      expect(snapshot?.displayTags).toEqual(['y-tab']);
    } finally {
      act(() => renderer.unmount());
      vi.useRealTimers();
    }
  });
});
