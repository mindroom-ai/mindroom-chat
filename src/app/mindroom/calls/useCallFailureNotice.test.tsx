import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { EventType, MatrixEvent, RoomEvent } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CALL_FAILURE_CONTENT_KEY } from './callFailureNotice';
import { useCallFailureNotice } from './useCallFailureNotice';

const mocks = vi.hoisted(() => ({
  crypto: {},
  handler: undefined as ((...args: any[]) => Promise<void>) | undefined,
  mx: {
    getCrypto: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  liveEvents: [] as MatrixEvent[],
  room: {
    roomId: '!call:example.org',
    getLiveTimeline: () => ({ getEvents: () => mocks.liveEvents }),
  },
}));

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => mocks.mx,
}));

vi.mock('../../hooks/useRoom', () => ({
  useRoom: () => mocks.room,
}));

let observed: ReturnType<typeof useCallFailureNotice>;

function Probe({ joined }: { joined: boolean }) {
  observed = useCallFailureNotice(joined);
  return null;
}

const markedEvent = () =>
  new MatrixEvent({
    event_id: '$failure',
    origin_server_ts: 123,
    room_id: mocks.room.roomId,
    sender: '@agent:example.org',
    type: EventType.RoomMessage,
    content: {
      msgtype: 'm.notice',
      body: 'Voice call error: update the credential and restart MindRoom.',
      [CALL_FAILURE_CONTENT_KEY]: { version: 1 },
    },
  });

const emitTimeline = async (event: MatrixEvent, liveEvent = true) => {
  await mocks.handler?.(event, mocks.room, false, false, { liveEvent });
};

describe('useCallFailureNotice', () => {
  let renderer: ReactTestRenderer;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handler = undefined;
    mocks.liveEvents = [];
    mocks.mx.getCrypto.mockReturnValue(mocks.crypto);
    mocks.mx.on.mockImplementation((event, handler) => {
      if (event === RoomEvent.Timeline) mocks.handler = handler;
    });
    observed = undefined;
  });

  it('shows only marked live notices received while the call is joined', async () => {
    act(() => {
      renderer = create(<Probe joined />);
    });

    await act(async () => emitTimeline(markedEvent(), false));
    expect(observed).toBeUndefined();

    await act(async () =>
      emitTimeline(
        new MatrixEvent({
          event_id: '$ordinary',
          origin_server_ts: 124,
          room_id: mocks.room.roomId,
          sender: '@agent:example.org',
          type: EventType.RoomMessage,
          content: { msgtype: 'm.notice', body: 'Ordinary notice.' },
        })
      )
    );
    expect(observed).toBeUndefined();

    await act(async () => emitTimeline(markedEvent()));
    expect(observed).toEqual({
      eventId: '$failure',
      message: 'Voice call error: update the credential and restart MindRoom.',
    });

    act(() => renderer.update(<Probe joined={false} />));
    expect(observed).toBeUndefined();
    expect(mocks.mx.removeListener).toHaveBeenCalledWith(RoomEvent.Timeline, expect.any(Function));
  });

  it('waits for encrypted failure notices to decrypt', async () => {
    act(() => {
      renderer = create(<Probe joined />);
    });
    const event = markedEvent();
    vi.spyOn(event, 'isEncrypted').mockReturnValue(true);
    vi.spyOn(event, 'isBeingDecrypted').mockReturnValue(false);
    const decrypt = vi.spyOn(event, 'attemptDecryption').mockResolvedValue();
    vi.spyOn(event, 'getDecryptionPromise').mockResolvedValue();
    vi.spyOn(event, 'isDecryptionFailure').mockReturnValue(false);

    await act(async () => emitTimeline(event));

    expect(decrypt).toHaveBeenCalledWith(mocks.crypto);
    expect(observed?.eventId).toBe('$failure');
    act(() => renderer.unmount());
  });

  it('catches a recent failure that raced with the joined listener', async () => {
    const event = markedEvent();
    vi.spyOn(event, 'getTs').mockReturnValue(Date.now());
    mocks.liveEvents = [event];

    await act(async () => {
      renderer = create(<Probe joined />);
      await Promise.resolve();
    });

    expect(observed?.eventId).toBe('$failure');
    act(() => renderer.unmount());
  });
});
