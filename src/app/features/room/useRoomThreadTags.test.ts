import React from 'react';
import { create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { StateEvent } from '../../../types/matrix/room';
import { useStateEvent } from '../../hooks/useStateEvent';
import { useStateEvents } from '../../hooks/useStateEvents';
import { useRoomThreadResolutionMap, useThreadResolution } from './useRoomThreadTags';

vi.mock('../../hooks/useStateEvent', () => ({
  useStateEvent: vi.fn(),
}));

vi.mock('../../hooks/useStateEvents', () => ({
  useStateEvents: vi.fn(),
}));

const mockedUseStateEvent = vi.mocked(useStateEvent);
const mockedUseStateEvents = vi.mocked(useStateEvents);

afterEach(() => {
  vi.clearAllMocks();
});

const makeThreadTagsEvent = (stateKey: string) =>
  new MatrixEvent({
    content: {
      tags: {
        resolved: { set_by: '@alice:example.org', set_at: 1000 },
        urgent: { set_by: '@alice:example.org', set_at: 1001 },
      },
    },
    event_id: `$thread-tags-${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: stateKey,
    type: StateEvent.ThreadTags,
  });

type ResolutionHarnessProps = {
  room: Room;
  threadRootId: string | undefined;
  onRender: (value: ReturnType<typeof useThreadResolution>) => void;
};

function ResolutionHarness({ room, threadRootId, onRender }: ResolutionHarnessProps) {
  onRender(useThreadResolution(room, threadRootId));
  return null;
}

type MapHarnessProps = {
  room: Room;
  onRender: (value: ReturnType<typeof useRoomThreadResolutionMap>) => void;
};

function MapHarness({ room, onRender }: MapHarnessProps) {
  onRender(useRoomThreadResolutionMap(room));
  return null;
}

describe('useRoomThreadTags compatibility with threadTags parser', () => {
  it('reads resolved state and plain tag names from thread-tag state events', () => {
    const room = { roomId: '!room:example.org' } as Room;
    const event = makeThreadTagsEvent('$root');
    mockedUseStateEvent.mockImplementation((_room, eventType, stateKey) => {
      if (eventType === StateEvent.ThreadTags && stateKey === '$root') return event;
      return undefined;
    });

    let snapshot: ReturnType<typeof useThreadResolution> | undefined;
    const renderer = create(
      React.createElement(ResolutionHarness, {
        room,
        threadRootId: '$root',
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    expect(snapshot?.isResolved).toBe(true);
    expect(snapshot?.tags).toEqual({
      resolved: { set_by: '@alice:example.org', set_at: 1000 },
      urgent: { set_by: '@alice:example.org', set_at: 1001 },
    });

    renderer.unmount();
  });

  it('builds a room resolution map with unwrapped tag content', () => {
    const room = { roomId: '!room:example.org' } as Room;
    const event = makeThreadTagsEvent('$root');
    mockedUseStateEvents.mockImplementation((_room, eventType) => {
      if (eventType === StateEvent.ThreadTags) return [event];
      return [];
    });

    let snapshot: ReturnType<typeof useRoomThreadResolutionMap> | undefined;
    const renderer = create(
      React.createElement(MapHarness, {
        room,
        onRender: (value) => {
          snapshot = value;
        },
      })
    );

    expect(snapshot?.get('$root')).toMatchObject({
      isResolved: true,
      tags: {
        resolved: { set_by: '@alice:example.org', set_at: 1000 },
        urgent: { set_by: '@alice:example.org', set_at: 1001 },
      },
    });

    renderer.unmount();
  });
});
