import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MatrixEvent } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoomEvent } from './useRoomEvent';

const fetchRoomEventMock = vi.fn();
const loadCachedRoomEventMock = vi.fn();
const loadCachedThreadEventMock = vi.fn();
const useActiveSessionMock = vi.fn();

vi.mock('./useMatrixClient', () => ({
  useMatrixClient: () => ({
    fetchRoomEvent: fetchRoomEventMock,
    getCrypto: () => undefined,
  }),
}));

vi.mock('./useSessionStore', () => ({
  useActiveSession: () => useActiveSessionMock(),
}));

vi.mock('../features/room/roomEventCache', () => ({
  loadCachedRoomEvent: (...args: unknown[]) => loadCachedRoomEventMock(...args),
}));

vi.mock('../features/room/threadEventCache', () => ({
  loadCachedThreadEvent: (...args: unknown[]) => loadCachedThreadEventMock(...args),
}));

const flushAsyncWork = async (ticks = 5) => {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const makeRoom = () =>
  ({
    findEventById: vi.fn(() => undefined),
    roomId: '!room:example.org',
  }) as any;

const makeRawEvent = (eventId: string) => ({
  content: { body: `body-${eventId}` },
  event_id: eventId,
  origin_server_ts: 123,
  type: 'm.room.message',
});

const EventProbe = ({
  eventId,
  getLocally,
  onEvent,
  options,
}: {
  eventId: string;
  getLocally?: () => MatrixEvent | undefined;
  onEvent: (event: MatrixEvent | undefined | null) => void;
  options?: { threadId?: string };
}) => {
  const event = useRoomEvent(makeRoom(), eventId, getLocally, options);

  useEffect(() => {
    onEvent(event);
  }, [event, onEvent]);

  return null;
};

describe('useRoomEvent', () => {
  afterEach(() => {
    fetchRoomEventMock.mockReset();
    loadCachedRoomEventMock.mockReset();
    loadCachedThreadEventMock.mockReset();
    useActiveSessionMock.mockReset();
  });

  it('uses local thread event lookups before cache or network', async () => {
    const localEvent = new MatrixEvent(makeRawEvent('$local'));
    const onEvent = vi.fn();
    useActiveSessionMock.mockReturnValue({ sessionId: 'session-1' });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(EventProbe, {
              eventId: '$local',
              getLocally: () => localEvent,
              onEvent,
            })
          )
        );
        await flushAsyncWork();
      });

      expect(onEvent).toHaveBeenLastCalledWith(localEvent);
      expect(loadCachedThreadEventMock).not.toHaveBeenCalled();
      expect(loadCachedRoomEventMock).not.toHaveBeenCalled();
      expect(fetchRoomEventMock).not.toHaveBeenCalled();
    } finally {
      renderer?.unmount();
      queryClient.clear();
    }
  });

  it('hydrates a thread reply target from thread cache before network', async () => {
    const onEvent = vi.fn();
    useActiveSessionMock.mockReturnValue({ sessionId: 'session-1' });
    loadCachedThreadEventMock.mockResolvedValue(makeRawEvent('$thread-reply'));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(EventProbe, {
              eventId: '$thread-reply',
              onEvent,
              options: { threadId: '$thread-root' },
            })
          )
        );
        await flushAsyncWork(10);
      });

      const resolvedEvent = onEvent.mock.calls.at(-1)?.[0] as MatrixEvent | undefined;
      expect(resolvedEvent?.getId()).toBe('$thread-reply');
      expect(loadCachedThreadEventMock).toHaveBeenCalledWith(
        'session-1',
        '!room:example.org',
        '$thread-root',
        '$thread-reply'
      );
      expect(fetchRoomEventMock).not.toHaveBeenCalled();
    } finally {
      renderer?.unmount();
      queryClient.clear();
    }
  });

  it('hydrates a reply target from room cache before network', async () => {
    const onEvent = vi.fn();
    useActiveSessionMock.mockReturnValue({ sessionId: 'session-1' });
    loadCachedThreadEventMock.mockResolvedValue(undefined);
    loadCachedRoomEventMock.mockResolvedValue(makeRawEvent('$room-reply'));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(EventProbe, {
              eventId: '$room-reply',
              onEvent,
              options: { threadId: '$thread-root' },
            })
          )
        );
        await flushAsyncWork(10);
      });

      const resolvedEvent = onEvent.mock.calls.at(-1)?.[0] as MatrixEvent | undefined;
      expect(resolvedEvent?.getId()).toBe('$room-reply');
      expect(loadCachedRoomEventMock).toHaveBeenCalledWith(
        'session-1',
        '!room:example.org',
        '$room-reply'
      );
      expect(fetchRoomEventMock).not.toHaveBeenCalled();
    } finally {
      renderer?.unmount();
      queryClient.clear();
    }
  });

  it('falls back to network when cache reads fail', async () => {
    const onEvent = vi.fn();
    useActiveSessionMock.mockReturnValue({ sessionId: 'session-1' });
    loadCachedThreadEventMock.mockRejectedValue(new Error('thread cache unavailable'));
    loadCachedRoomEventMock.mockRejectedValue(new Error('room cache unavailable'));
    fetchRoomEventMock.mockResolvedValue(makeRawEvent('$network-reply'));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(EventProbe, {
              eventId: '$network-reply',
              onEvent,
              options: { threadId: '$thread-root' },
            })
          )
        );
        await flushAsyncWork(10);
      });

      const resolvedEvent = onEvent.mock.calls.at(-1)?.[0] as MatrixEvent | undefined;
      expect(resolvedEvent?.getId()).toBe('$network-reply');
      expect(fetchRoomEventMock).toHaveBeenCalledWith('!room:example.org', '$network-reply');
    } finally {
      renderer?.unmount();
      queryClient.clear();
    }
  });
});
