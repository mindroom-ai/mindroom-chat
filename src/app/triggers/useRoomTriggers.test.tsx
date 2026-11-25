// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { useRoomTriggers } from './useRoomTriggers';
import { triggerRowJson } from './useRoomTriggers.test.shared';

type SendFn = (path: string, init?: RequestInit) => Promise<Response>;
const mocks = vi.hoisted(
  (): {
    send: ReturnType<typeof vi.fn<SendFn>>;
    server: { apiUrl: string | undefined; pending: boolean };
  } => ({
    send: vi.fn<SendFn>(),
    server: { apiUrl: 'https://mindroom.example.org', pending: false },
  })
);

vi.mock('../computer/useRoomMindroomServer', () => ({
  useRoomMindroomServer: () => mocks.server,
}));
vi.mock('../computer/clientSessions', () => ({
  clientSessions: () => ({ send: mocks.send }),
}));

const makeRow = (id: string, enabled = true) =>
  triggerRowJson({
    trigger_id: id,
    description: `Trigger ${id}`,
    target_room_id: '!roomA:example.org',
    enabled,
    disabled_reason: enabled ? null : 'manual',
  });

const mx = { getUserId: () => '@alice:example.org' } as unknown as MatrixClient;
const makeRoom = (roomId: string, membership = 'join'): Room =>
  ({ roomId, getMyMembership: () => membership }) as unknown as Room;

const makeWrapper = (queryClient: QueryClient) =>
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
  it('refetches on demand, keeps cached rows on refetch failure while setting loadFailed, and invalidates after mutations', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const room = makeRoom('!roomA:example.org');

    mocks.send.mockResolvedValueOnce(
      new Response(JSON.stringify({ triggers: [makeRow('tr_a', true)] }), { status: 200 })
    );
    const { result } = renderHook(() => useRoomTriggers(room), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.triggers).toHaveLength(1));

    // Refetch network blip keeps cached rows for the header count while marking loadFailed for the dialog.
    mocks.send.mockRejectedValueOnce(new Error('network blip'));
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.triggers.map((t) => t.triggerId)).toEqual(['tr_a']);

    // Seed another room's triggers cache so we verify mutations invalidate all rooms (watch targets).
    const otherRoomKey = ['room-triggers', '!roomB:example.org', 'https://mindroom.example.org'];
    queryClient.setQueryData(otherRoomKey, []);

    // Toggle sends PATCH and invalidates the room-triggers prefix, clearing loadFailed when GET succeeds.
    mocks.send
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ triggers: [makeRow('tr_a', false)] }), { status: 200 })
      );
    await act(async () => {
      await result.current.toggleTrigger('tr_a', false);
    });
    await waitFor(() => expect(result.current.triggers[0]?.enabled).toBe(false));
    expect(result.current.loadFailed).toBe(false);
    expect(queryClient.getQueryState(otherRoomKey)?.isInvalidated).toBe(true);

    // PATCH 200 followed by GET failure marks loadFailed instead of leaving a stale Off row.
    mocks.send
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new Error('refresh failed'));
    await act(async () => {
      await result.current.toggleTrigger('tr_a', true);
    });
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    // Delete sends DELETE and invalidates; a rejected refetch after cached [] still marks loadFailed.
    mocks.send
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ triggers: [] }), { status: 200 }));
    await act(async () => {
      await result.current.deleteTrigger('tr_a');
    });
    await waitFor(() => expect(result.current.triggers).toEqual([]));
    expect(result.current.loadFailed).toBe(false);

    mocks.send.mockRejectedValueOnce(new Error('empty refetch failed'));
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.triggers).toEqual([]);
  });

  it('marks loadFailed on no server, 404, or failed first load', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const room = makeRoom('!roomA:example.org');

    mocks.server = { apiUrl: undefined, pending: false };
    const { result, rerender } = renderHook(() => useRoomTriggers(room), {
      wrapper: makeWrapper(queryClient),
    });
    expect(result.current.triggers).toEqual([]);
    expect(result.current.loadFailed).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.server = { apiUrl: 'https://mindroom.example.org', pending: false };
    mocks.send.mockRejectedValueOnce(new Error('offline'));
    rerender();
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.triggers).toEqual([]);
    expect(result.current.loadFailed).toBe(true);

    mocks.send.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.triggers).toEqual([]);
    expect(result.current.loadFailed).toBe(true);
  });

  it('ignores refetch while server resolution is pending with a provisional URL or when not joined', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const room = makeRoom('!roomA:example.org');

    mocks.server = { apiUrl: 'https://provisional.example.org', pending: true };
    const { result, rerender } = renderHook(() => useRoomTriggers(room), {
      wrapper: makeWrapper(queryClient),
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await result.current.refetch();
    });
    expect(mocks.send).not.toHaveBeenCalled();

    // Settling the server enables the query and triggers a single fetch.
    mocks.server = { apiUrl: 'https://settled.example.org', pending: false };
    mocks.send.mockResolvedValueOnce(
      new Response(JSON.stringify({ triggers: [makeRow('tr_a', true)] }), { status: 200 })
    );
    rerender();
    await waitFor(() => expect(result.current.triggers).toHaveLength(1));
    expect(mocks.send).toHaveBeenCalledTimes(1);

    // Leaving the room disables refetch again.
    const leftRoom = makeRoom('!roomA:example.org', 'leave');
    const leftHook = renderHook(() => useRoomTriggers(leftRoom), {
      wrapper: makeWrapper(queryClient),
    });
    await act(async () => {
      await leftHook.result.current.refetch();
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
