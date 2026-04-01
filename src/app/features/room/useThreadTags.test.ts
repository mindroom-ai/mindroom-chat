import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { StateEvent } from '../../../types/matrix/room';
import { useStateEvent } from '../../hooks/useStateEvent';
import { useStateEvents } from '../../hooks/useStateEvents';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { getPendingThreadTagsContent, resetPendingThreadTagsForTests, setPendingThreadTagsContent } from './threadTagPending';
import { useThreadTags } from './useThreadTags';

vi.mock('../../hooks/useStateEvent', () => ({
  useStateEvent: vi.fn(),
}));

vi.mock('../../hooks/useStateEvents', () => ({
  useStateEvents: vi.fn(),
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

vi.mock('../../hooks/usePowerLevels', () => ({
  usePowerLevelsContext: vi.fn(),
}));

vi.mock('../../hooks/useRoomCreators', () => ({
  useRoomCreators: vi.fn(),
}));

vi.mock('../../hooks/useRoomPermissions', () => ({
  useRoomPermissions: vi.fn(),
}));

const mockedUseStateEvent = vi.mocked(useStateEvent);
const mockedUseStateEvents = vi.mocked(useStateEvents);
const mockedUseMatrixClient = vi.mocked(useMatrixClient);
const mockedUsePowerLevelsContext = vi.mocked(usePowerLevelsContext);
const mockedUseRoomCreators = vi.mocked(useRoomCreators);
const mockedUseRoomPermissions = vi.mocked(useRoomPermissions);

type HarnessProps = {
  room: Room;
  threadRootId?: string;
  onRender: (value: ReturnType<typeof useThreadTags>) => void;
};

function Harness({ room, threadRootId, onRender }: HarnessProps) {
  onRender(useThreadTags(room, threadRootId));
  return null;
}

const makeTagEvent = (stateKey: string) =>
  new MatrixEvent({
    content: {
      tags: {
        bug: { set_by: '@alice:example.org', set_at: 123 },
      },
    },
    event_id: `$thread-tags-${stateKey}`,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    state_key: stateKey,
    type: StateEvent.ThreadTags,
  });

describe('useThreadTags', () => {
  beforeEach(() => {
    mockedUseStateEvent.mockReturnValue(undefined);
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
    const room = { roomId: '!room:example.org' } as Room;
    setPendingThreadTagsContent(room.roomId, '$root', {
      tags: {
        bug: { set_by: '@alice:example.org', set_at: 123 },
      },
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
      bug: { set_by: '@alice:example.org', set_at: 123 },
    });
    expect(snapshot?.isResolved).toBe(false);

    renderer.unmount();
  });

  it('clears the pending custom tag once the live state matches it', () => {
    const room = { roomId: '!room:example.org' } as Room;
    const event = makeTagEvent('$root');
    mockedUseStateEvent.mockReturnValue(event);

    setPendingThreadTagsContent(room.roomId, '$root', {
      tags: {
        bug: { set_by: '@alice:example.org', set_at: 123 },
      },
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
    expect(getPendingThreadTagsContent(room.roomId, '$root')).toBeUndefined();

    renderer?.unmount();
  });
});
