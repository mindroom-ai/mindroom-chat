import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getPendingThreadTagsContent, resetPendingThreadTagsForTests } from './threadTagPending';
import { useMutateThreadTags } from './useMutateThreadTags';

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: vi.fn(),
}));

const mockedUseMatrixClient = vi.mocked(useMatrixClient);

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

describe('useMutateThreadTags', () => {
  const sendStateEvent = vi.fn();

  beforeEach(() => {
    sendStateEvent.mockReset();
    sendStateEvent.mockResolvedValue(undefined);
    mockedUseMatrixClient.mockReturnValue({
      getSafeUserId: () => '@alice:example.org',
      sendStateEvent,
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetPendingThreadTagsForTests();
  });

  it('writes new tags to the canonical thread root and seeds pending state immediately', async () => {
    const rootEvent = makeThreadRootEvent('$root');
    const room = {
      roomId: '!room:example.org',
      getThread: (threadId: string) =>
        threadId === '$root' ? ({ rootEvent } as never) : undefined,
      findEventById: () => undefined,
      getLiveTimeline: () => ({
        getState: () => ({
          getStateEvents: () => undefined,
        }),
      }),
    } as unknown as Room;

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
      'com.mindroom.thread.tags',
      {
        tags: {
          bug: expect.objectContaining({
            set_by: '@alice:example.org',
          }),
        },
      },
      '$root'
    );
    expect(getPendingThreadTagsContent('!room:example.org', '$root')).toEqual(
      expect.objectContaining({
        tags: {
          bug: expect.objectContaining({
            set_by: '@alice:example.org',
          }),
        },
      })
    );

    renderer.unmount();
  });
});
