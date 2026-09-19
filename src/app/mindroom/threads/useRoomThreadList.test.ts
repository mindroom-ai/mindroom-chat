import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { loadRoomThreads } from './roomThreadList';
import { useRoomThreadList } from './useRoomThreadList';

vi.mock('./roomThreadList', async (importOriginal) => {
  const original = await importOriginal<typeof import('./roomThreadList')>();
  return {
    ...original,
    loadRoomThreads: vi.fn(),
  };
});

const mockedLoadRoomThreads = vi.mocked(loadRoomThreads);

type ThreadListSnapshot = ReturnType<typeof useRoomThreadList>;

function Harness({
  enabled,
  onRender,
  room,
}: {
  enabled: boolean;
  onRender: (snapshot: ThreadListSnapshot) => void;
  room: Room;
}) {
  onRender(useRoomThreadList(room, enabled));
  return null;
}

const makeRoom = () =>
  ({
    getThreads: () => [],
    on: vi.fn(),
    removeListener: vi.fn(),
    threadsTimelineSets: [],
  } as unknown as Room);

afterEach(() => {
  mockedLoadRoomThreads.mockReset();
});

describe('useRoomThreadList', () => {
  it('cancels automatic and retry loads together without applying a stale retry error', async () => {
    const pendingLoads: Array<{
      reject: (error: Error) => void;
      signal: AbortSignal | undefined;
    }> = [];
    mockedLoadRoomThreads.mockImplementation((_room, _onProgress, signal) => {
      const promise = new Promise<void>((_resolve, reject) => {
        pendingLoads.push({ reject, signal });
      });
      return promise;
    });

    const room = makeRoom();
    const mx = { getUserId: () => '@self:example.org' };
    let snapshot: ThreadListSnapshot | undefined;
    let renderer!: ReactTestRenderer;
    const render = (enabled: boolean) =>
      React.createElement(
        MatrixClientProvider,
        { value: mx as never },
        React.createElement(Harness, {
          enabled,
          onRender: (value) => {
            snapshot = value;
          },
          room,
        })
      );

    await act(async () => {
      renderer = create(render(true));
    });
    expect(pendingLoads).toHaveLength(1);

    let retry: Promise<void> | undefined;
    await act(async () => {
      retry = snapshot?.retry();
    });
    expect(pendingLoads).toHaveLength(2);
    expect(pendingLoads[0].signal).toBe(pendingLoads[1].signal);
    expect(pendingLoads[0].signal?.aborted).toBe(false);

    await act(async () => {
      renderer.update(render(false));
    });
    expect(pendingLoads[0].signal?.aborted).toBe(true);

    await act(async () => {
      pendingLoads.forEach(({ reject }) => reject(new Error('late failure')));
      await retry;
    });

    expect(snapshot?.loading).toBe(false);
    expect(snapshot?.error).toBeUndefined();

    renderer.unmount();
  });
});
