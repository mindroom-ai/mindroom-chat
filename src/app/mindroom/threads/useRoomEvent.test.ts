import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoomEvent } from './useRoomEvent';
import { usePinnedThreadEvents } from './usePinnedThreadEvents';

const pins = vi.hoisted(() => ({ ids: ['$old', '$reply', '$deleted'] }));
vi.mock('./useThreadPinning', () => ({ usePinnedEventIds: () => pins.ids }));

const fetchRoomEventMock = vi.fn();
const loadCachedRoomEventMock = vi.fn();
const loadCachedThreadEventMock = vi.fn();
const useActiveSessionMock = vi.fn();

vi.mock('../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    fetchRoomEvent: fetchRoomEventMock,
    getCrypto: () => undefined,
  }),
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: () => useActiveSessionMock(),
}));

vi.mock('./eventRepository', () => ({
  loadCachedRoomEvent: (...args: unknown[]) => loadCachedRoomEventMock(...args),
  loadCachedThreadEvent: (...args: unknown[]) => loadCachedThreadEventMock(...args),
}));

const flushAsyncWork = async (ticks = 5) => {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

const makeRoom = () =>
  ({
    findEventById: vi.fn(() => undefined),
    getUnfilteredTimelineSet: () => ({ getTimelines: () => [] }),
    on: vi.fn(),
    removeListener: vi.fn(),
    roomId: '!room:example.org',
  } as any);

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
  it.each(['redaction', 'edit'])(
    'updates a detached pinned root after a live %s',
    async (change) => {
      pins.ids = ['$old'];
      useActiveSessionMock.mockReturnValue(undefined);
      const mx = createClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
      const room = new Room('!room:example.org', mx, '@alice:example.org');
      const edit = (id: string, body: string, ts: number) => ({
        event_id: id,
        room_id: room.roomId,
        sender: '@alice:example.org',
        origin_server_ts: ts,
        type: 'm.room.message',
        content: {
          msgtype: 'm.text',
          body: `* ${body}`,
          'm.new_content': { msgtype: 'm.text', body },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$old' },
        },
      });
      fetchRoomEventMock.mockResolvedValue({
        ...makeRawEvent('$old'),
        room_id: room.roomId,
        sender: '@alice:example.org',
        content: { msgtype: 'm.text', body: 'Original announcement' },
        unsigned: { 'm.relations': { 'm.replace': edit('$first-edit', 'First edit', 200) } },
      });
      let events: MatrixEvent[] = [];
      function Probe() {
        events = usePinnedThreadEvents(room, true);
        return null;
      }
      const client = new QueryClient();
      let renderer!: ReturnType<typeof create>;
      try {
        await act(async () => {
          renderer = create(
            React.createElement(QueryClientProvider, { client }, React.createElement(Probe))
          );
          await flushAsyncWork();
        });
        expect(events[0].getContent().body).toBe('First edit');
        await act(async () => {
          await room.addLiveEvents(
            [
              new MatrixEvent(
                change === 'edit'
                  ? edit('$second-edit', 'Latest edit', 300)
                  : {
                      event_id: '$redaction',
                      room_id: room.roomId,
                      sender: '@alice:example.org',
                      origin_server_ts: 300,
                      type: 'm.room.redaction',
                      redacts: '$old',
                      content: {},
                    }
              ),
            ],
            { addToState: true }
          );
          await flushAsyncWork();
        });
        if (change === 'redaction') expect(events).toEqual([]);
        else expect(events[0].getContent().body).toBe('Latest edit');
      } finally {
        act(() => renderer?.unmount());
        client.clear();
      }
    }
  );
  it('loads old pinned roots from cache and excludes pinned replies and deleted roots', async () => {
    useActiveSessionMock.mockReturnValue({ sessionId: 'session-1' });
    loadCachedRoomEventMock.mockImplementation(async (_session, _room, id) => ({
      ...makeRawEvent(id),
      content:
        id === '$reply'
          ? { body: 'reply', 'm.relates_to': { rel_type: 'm.thread', event_id: '$old' } }
          : id === '$deleted'
          ? {}
          : { body: 'Older announcement', msgtype: 'm.text' },
      unsigned: id === '$deleted' ? { redacted_because: { type: 'm.room.redaction' } } : {},
    }));
    const room = makeRoom();
    let events: MatrixEvent[] = [];
    function Probe() {
      events = usePinnedThreadEvents(room, true);
      return null;
    }
    const client = new QueryClient();
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(QueryClientProvider, { client }, React.createElement(Probe))
      );
      await flushAsyncWork();
    });
    expect(events.map((event) => event.getId())).toEqual(['$old']);
    expect(events[0].getContent().body).toBe('Older announcement');
    expect(fetchRoomEventMock).not.toHaveBeenCalled();
    renderer.unmount();
    client.clear();
  });

  it('upgrades a cached pin to the newer live root on a room refresh', async () => {
    useActiveSessionMock.mockReturnValue({ sessionId: 'session-1' });
    loadCachedRoomEventMock.mockImplementation(async (_session, _room, id) => makeRawEvent(id));
    const room = makeRoom();
    let events: MatrixEvent[] = [];
    function Probe({ revision }: { revision: number }) {
      events = usePinnedThreadEvents(room, true, revision);
      return null;
    }
    const client = new QueryClient();
    const render = (revision: number) =>
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(Probe, { revision })
      );
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(render(0));
      await flushAsyncWork();
    });
    expect(events[0].getContent().body).toBe('body-$old');
    const live = new MatrixEvent({
      ...makeRawEvent('$old'),
      content: { body: 'Updated announcement' },
    });
    room.findEventById.mockImplementation((id: string) => (id === '$old' ? live : undefined));
    act(() => renderer.update(render(1)));
    expect(events[0].getContent().body).toBe('Updated announcement');
    renderer.unmount();
    client.clear();
  });
  afterEach(() => {
    pins.ids = ['$old', '$reply', '$deleted'];
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

  // The retry behavior below is driven by the hook's own per-query `retry`
  // predicate: these QueryClients deliberately do NOT set a default `retry`
  // (per-query options take precedence over defaults anyway), only a zero
  // retry delay, which the hook does not override.

  it('does not retry M_NOT_FOUND fetches and settles to null', async () => {
    const onEvent = vi.fn();
    useActiveSessionMock.mockReturnValue(undefined);
    fetchRoomEventMock.mockRejectedValue(
      Object.assign(new Error('event not found'), { errcode: 'M_NOT_FOUND' })
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: () => 0 } },
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(EventProbe, {
              eventId: '$missing-forever',
              onEvent,
            })
          )
        );
        await flushAsyncWork(20);
      });

      expect(onEvent).toHaveBeenLastCalledWith(null);
      expect(fetchRoomEventMock).toHaveBeenCalledTimes(1);
    } finally {
      renderer?.unmount();
      queryClient.clear();
    }
  });

  it('retries transient fetch failures before settling to null', async () => {
    const onEvent = vi.fn();
    useActiveSessionMock.mockReturnValue(undefined);
    fetchRoomEventMock.mockRejectedValue(new Error('gateway timeout'));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: () => 0 } },
    });

    let renderer: ReturnType<typeof create> | undefined;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(EventProbe, {
              eventId: '$flaky-fetch',
              onEvent,
            })
          )
        );
        await flushAsyncWork(30);
      });

      expect(onEvent).toHaveBeenLastCalledWith(null);
      // Initial attempt plus the predicate's failureCount < 3 retries.
      expect(fetchRoomEventMock).toHaveBeenCalledTimes(4);
    } finally {
      renderer?.unmount();
      queryClient.clear();
    }
  });
});
