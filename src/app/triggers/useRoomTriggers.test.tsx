// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MatrixEvent, MatrixEventEvent, RoomEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { useRoomTriggers } from './useRoomTriggers';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  server: { apiUrl: 'https://mindroom.example.org' as string | undefined, pending: false },
}));

vi.mock('../computer/useRoomMindroomServer', () => ({
  useRoomMindroomServer: () => mocks.server,
}));
vi.mock('../computer/clientSessions', () => ({
  clientSessions: () => ({ send: mocks.send }),
}));

const makeRow = (id: string, enabled = true) => ({
  trigger_id: id,
  kind: 'room_message',
  relation: 'target',
  description: `Trigger ${id}`,
  prompt: 'Summarize new issues in the Design channel',
  agent: 'assistant',
  target_room_id: '!roomA:example.org',
  target_thread_id: '$thread1',
  thread_mode: 'thread',
  enabled,
  disabled_reason: enabled ? null : 'manual',
  once: false,
  expires_at: null,
  last_fired_at: 1764000000000,
  owner_user_id: '@alice:example.org',
  can_manage: true,
});

const makeClient = () => {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    getUserId: () => '@alice:example.org',
  }) as unknown as MatrixClient & EventEmitter;
};

const makeRoom = (roomId: string, membership = 'join'): Room =>
  ({ roomId, getMyMembership: () => membership }) as unknown as Room;

const makeWrapper = (mx: MatrixClient, queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MatrixClientProvider value={mx}>{children}</MatrixClientProvider>
      </QueryClientProvider>
    );
  };

afterEach(() => {
  mocks.send.mockReset();
  mocks.server = { apiUrl: 'https://mindroom.example.org', pending: false };
});

describe('useRoomTriggers', () => {
  it('caches per room across switches so returning to a room renders immediately without flicker', async () => {
    const mx = makeClient();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const roomA = makeRoom('!roomA:example.org');
    const roomB = makeRoom('!roomB:example.org');

    mocks.send.mockImplementation(async (path: string) => {
      if (path.includes('roomA')) {
        return new Response(JSON.stringify({ triggers: [makeRow('tr_a')] }), { status: 200 });
      }
      return new Response(JSON.stringify({ triggers: [] }), { status: 200 });
    });

    const { result, rerender } = renderHook(({ room }) => useRoomTriggers(room), {
      initialProps: { room: roomA },
      wrapper: makeWrapper(mx, queryClient),
    });

    await waitFor(() => expect(result.current.triggers).toHaveLength(1));
    expect(result.current.triggers[0]?.triggerId).toBe('tr_a');

    // Switch to room B: does not leak room A's triggers.
    rerender({ room: roomB });
    expect(result.current.triggers).toEqual([]);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));

    // Switch back to room A: cached rows are available synchronously on the first render.
    let resolveBg!: (value: Response) => void;
    mocks.send.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveBg = resolve))
    );
    rerender({ room: roomA });
    expect(result.current.triggers.map((t) => t.triggerId)).toEqual(['tr_a']);

    await act(async () => {
      resolveBg(new Response(JSON.stringify({ triggers: [makeRow('tr_a')] }), { status: 200 }));
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
  });

  it('refetches when a live trigger-wake message arrives (including after decryption) and after mutations', async () => {
    const mx = makeClient();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const room = makeRoom('!roomA:example.org');

    mocks.send.mockImplementation(
      async () =>
        new Response(JSON.stringify({ triggers: [makeRow('tr_a', true)] }), { status: 200 })
    );

    const { result } = renderHook(() => useRoomTriggers(room), {
      wrapper: makeWrapper(mx, queryClient),
    });
    await waitFor(() => expect(result.current.triggers).toHaveLength(1));
    expect(mocks.send).toHaveBeenCalledTimes(1);

    // Non-wake message does not trigger refetch.
    const ordinary = new MatrixEvent({
      type: 'm.room.message',
      room_id: room.roomId,
      sender: '@bob:example.org',
      content: { msgtype: 'm.text', body: 'Hello' },
    });
    act(() => {
      mx.emit(RoomEvent.Timeline, ordinary, room, false, false, { liveEvent: true });
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);

    // Live trigger wake from a MindRoom agent refetches.
    const wake = new MatrixEvent({
      type: 'm.room.message',
      room_id: room.roomId,
      sender: '@mindroom_assistant:example.org',
      content: {
        msgtype: 'm.text',
        body: 'Summarize new issues',
        'com.mindroom.source_kind': 'reactive_trigger',
        'com.mindroom.trigger_id': 'tr_a',
      },
    });
    act(() => {
      mx.emit(RoomEvent.Timeline, wake, room, false, false, { liveEvent: true });
    });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));

    // Encrypted live trigger wake refetches once decrypted.
    const encryptedWake = {
      getRoomId: () => room.roomId,
      isEncrypted: () => true,
      getType: () => 'm.room.encrypted',
      getSender: () => '@mindroom_assistant:example.org',
      getContent: () => ({}),
    } as unknown as MatrixEvent;
    act(() => {
      mx.emit(RoomEvent.Timeline, encryptedWake, room, false, false, { liveEvent: true });
    });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    Object.assign(encryptedWake, {
      getType: () => 'm.room.message',
      getContent: () => ({
        msgtype: 'm.text',
        body: 'Webhook fired',
        'com.mindroom.source_kind': 'external_trigger',
        'com.mindroom.external_trigger_id': 'tr_a',
      }),
    });
    act(() => {
      mx.emit(MatrixEventEvent.Decrypted, encryptedWake);
    });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(3));

    // Toggle sends PATCH and refetches.
    mocks.send
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeRow('tr_a', false)), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ triggers: [makeRow('tr_a', false)] }), { status: 200 })
      );
    await act(async () => {
      await result.current.toggleTrigger('tr_a', false);
    });
    await waitFor(() => expect(result.current.triggers[0]?.enabled).toBe(false));
    expect(mocks.send).toHaveBeenCalledTimes(5);

    // Delete sends DELETE and refetches.
    mocks.send
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ triggers: [] }), { status: 200 }));
    await act(async () => {
      await result.current.deleteTrigger('tr_a');
    });
    await waitFor(() => expect(result.current.triggers).toEqual([]));
    expect(mocks.send).toHaveBeenCalledTimes(7);
  });

  it('returns empty without fetching when there is no MindRoom server or API returns 404', async () => {
    const mx = makeClient();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const room = makeRoom('!roomA:example.org');

    mocks.server = { apiUrl: undefined, pending: false };
    const { result, rerender } = renderHook(() => useRoomTriggers(room), {
      wrapper: makeWrapper(mx, queryClient),
    });
    expect(result.current.triggers).toEqual([]);
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.server = { apiUrl: 'https://mindroom.example.org', pending: false };
    mocks.send.mockResolvedValueOnce(new Response(null, { status: 404 }));
    rerender();
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(result.current.triggers).toEqual([]);
  });
});
