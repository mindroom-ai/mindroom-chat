// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { useRoomTriggers } from './useRoomTriggers';

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

const makeRow = (id: string, enabled = true) => ({
  trigger_id: id,
  kind: 'room_message',
  relation: 'target',
  description: `Trigger ${id}`,
  prompt: 'Summarize new issues in the Design channel',
  target_room_id: '!roomA:example.org',
  target_thread_id: '$thread1',
  thread_mode: 'thread',
  enabled,
  disabled_reason: enabled ? null : 'manual',
  last_fired_at: 1764000000000,
  owner_user_id: '@alice:example.org',
  can_manage: true,
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
  it('caches per room across switches and uses staleTime on return', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const roomA = makeRoom('!roomA:example.org');
    const roomB = makeRoom('!roomB:example.org');

    mocks.send.mockImplementation(async (path: string) => {
      const triggers = path.includes('roomA') ? [makeRow('tr_a')] : [];
      return new Response(JSON.stringify({ triggers }), { status: 200 });
    });

    const { result, rerender } = renderHook(({ room }) => useRoomTriggers(room), {
      initialProps: { room: roomA },
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.triggers).toHaveLength(1));
    expect(result.current.loadFailed).toBe(false);

    rerender({ room: roomB });
    expect(result.current.triggers).toEqual([]);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(result.current.loadFailed).toBe(false);

    // Switch back to room A: served from cache without a redundant fetch.
    rerender({ room: roomA });
    expect(result.current.triggers.map((t) => t.triggerId)).toEqual(['tr_a']);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('refetches on demand and after toggle/delete mutations', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const room = makeRoom('!roomA:example.org');

    mocks.send.mockResolvedValueOnce(
      new Response(JSON.stringify({ triggers: [makeRow('tr_a', true)] }), { status: 200 })
    );
    const { result } = renderHook(() => useRoomTriggers(room), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.triggers).toHaveLength(1));

    mocks.send.mockResolvedValueOnce(
      new Response(JSON.stringify({ triggers: [makeRow('tr_a', true)] }), { status: 200 })
    );
    await act(async () => {
      await result.current.refetch();
    });
    expect(mocks.send).toHaveBeenCalledTimes(2);

    mocks.send
      .mockResolvedValueOnce(new Response(JSON.stringify(makeRow('tr_a', false)), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ triggers: [makeRow('tr_a', false)] }), { status: 200 })
      );
    await act(async () => {
      await result.current.toggleTrigger('tr_a', false);
    });
    await waitFor(() => expect(result.current.triggers[0]?.enabled).toBe(false));

    mocks.send
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ triggers: [] }), { status: 200 }));
    await act(async () => {
      await result.current.deleteTrigger('tr_a');
    });
    await waitFor(() => expect(result.current.triggers).toEqual([]));
  });

  it('marks loadFailed on no server or 404, but not on empty 200', async () => {
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
    mocks.send.mockResolvedValueOnce(new Response(null, { status: 404 }));
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.triggers).toEqual([]);
    expect(result.current.loadFailed).toBe(true);
  });
});
