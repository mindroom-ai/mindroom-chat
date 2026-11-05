import React from 'react';
import { type EventTimelineSet, type Room, RoomEvent } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useThreadAwareTimelineRefresh } from './useThreadAwareTimelineRefresh';

type RefreshSignal = (room: Room, timelineSet: EventTimelineSet) => void;

/** A room double that keeps its listeners, so a test can send the SDK's refresh signal. */
const makeRoom = (roomId = '!room:example.org') => {
  const listeners = new Map<string, Set<RefreshSignal>>();
  const on = vi.fn((event: string, listener: RefreshSignal) => {
    listeners.set(event, (listeners.get(event) ?? new Set()).add(listener));
  });
  const removeListener = vi.fn((event: string, listener: RefreshSignal) => {
    listeners.get(event)?.delete(listener);
  });
  const room = { roomId, on, removeListener } as unknown as Room;
  return {
    room,
    /** How many refresh listeners the room has now. */
    listenerCount: () => listeners.get(RoomEvent.TimelineRefresh)?.size ?? 0,
    /** Sends the refresh signal, for this room or one with another ID. */
    signal: (fromRoomId = roomId) => {
      listeners.get(RoomEvent.TimelineRefresh)?.forEach((listener) => {
        listener({ roomId: fromRoomId } as Room, {} as EventTimelineSet);
      });
    },
  };
};

/** A thread refresh whose calls stay open until the test settles them. */
const makeRefresh = () => {
  const calls: {
    threadId: string;
    resolve: (refreshed: boolean) => void;
    reject: (error: Error) => void;
  }[] = [];
  const refresh = vi.fn(
    (threadId: string) =>
      new Promise<boolean>((resolve, reject) => {
        calls.push({ threadId, resolve, reject });
      })
  );
  return { calls, refresh };
};

type HookProps = Parameters<typeof useThreadAwareTimelineRefresh>[0];

function Probe(props: HookProps) {
  useThreadAwareTimelineRefresh(props);
  return null;
}

const flush = async () => {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
};

describe('useThreadAwareTimelineRefresh behaviour', () => {
  let renderer: ReactTestRenderer | undefined;

  const render = async (props: HookProps) => {
    await act(async () => {
      if (renderer) renderer.update(React.createElement(Probe, props));
      else renderer = create(React.createElement(Probe, props));
    });
  };
  const run = async (step: () => void) => {
    await act(async () => {
      step();
      await flush();
    });
  };

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
  });

  it('rebuilds the room window on each signal only while the view reaches the live timeline', async () => {
    const { room, signal } = makeRoom();
    const onRoomRefresh = vi.fn();
    const { refresh } = makeRefresh();
    const props = {
      room,
      liveTimelineLinked: true,
      refreshLatestThreadSlice: refresh,
      onRoomRefresh,
    };
    await render(props);

    signal();
    signal();
    expect(onRoomRefresh).toHaveBeenCalledTimes(2);

    await render({ ...props, liveTimelineLinked: false });
    signal();
    expect(onRoomRefresh).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores signals for another room in the room view and in a thread', async () => {
    const { room, signal } = makeRoom();
    const onRoomRefresh = vi.fn();
    const { refresh } = makeRefresh();
    const props = {
      room,
      liveTimelineLinked: true,
      refreshLatestThreadSlice: refresh,
      onRoomRefresh,
    };
    await render(props);
    signal('!other:example.org');

    await render({ ...props, threadId: '$thread' });
    signal('!other:example.org');

    expect(onRoomRefresh).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('folds any number of signals during a refresh into one rerun', async () => {
    const { room, signal } = makeRoom();
    const onRoomRefresh = vi.fn();
    const { calls, refresh } = makeRefresh();
    await render({
      room,
      threadId: '$thread',
      liveTimelineLinked: true,
      refreshLatestThreadSlice: refresh,
      onRoomRefresh,
    });

    await run(signal);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith('$thread');

    await run(() => {
      for (let count = 0; count < 5; count += 1) signal();
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await run(() => calls[0]?.resolve(true));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith('$thread');

    await run(() => calls[1]?.resolve(false));
    expect(refresh).toHaveBeenCalledTimes(2);

    await run(signal);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(onRoomRefresh).not.toHaveBeenCalled();
  });

  it("starts the next thread's refresh at once and lets the previous one settle without effect", async () => {
    const { room, signal } = makeRoom();
    const { calls, refresh } = makeRefresh();
    const props = {
      room,
      liveTimelineLinked: true,
      refreshLatestThreadSlice: refresh,
      onRoomRefresh: vi.fn(),
    };
    await render({ ...props, threadId: '$a' });
    await run(signal);
    await run(signal);
    expect(refresh).toHaveBeenCalledTimes(1);

    await render({ ...props, threadId: '$b' });
    await run(signal);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith('$b');

    // A's queued rerun went with the switch; B's own refresh is still running.
    await run(() => calls[0]?.resolve(true));
    expect(refresh).toHaveBeenCalledTimes(2);
    await run(signal);
    expect(refresh).toHaveBeenCalledTimes(2);

    await run(() => calls[1]?.resolve(true));
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenLastCalledWith('$b');
  });

  it('drops a queued rerun as soon as the thread changes, even when the reader comes back', async () => {
    const { room, signal } = makeRoom();
    const { calls, refresh } = makeRefresh();
    const props = {
      room,
      liveTimelineLinked: true,
      refreshLatestThreadSlice: refresh,
      onRoomRefresh: vi.fn(),
    };
    await render({ ...props, threadId: '$a' });
    await run(signal);
    await run(signal);

    await render({ ...props, threadId: '$b' });
    await render({ ...props, threadId: '$a' });
    await run(() => calls[0]?.resolve(true));
    expect(refresh).toHaveBeenCalledTimes(1);

    // Back on A, its next signal starts a refresh as usual.
    await run(signal);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith('$a');
  });

  it('does not rerun a thread that is no longer shown, even when its old listener queued one', async () => {
    const { room, signal } = makeRoom();
    const { calls, refresh } = makeRefresh();
    const props = {
      room,
      liveTimelineLinked: true,
      refreshLatestThreadSlice: refresh,
      onRoomRefresh: vi.fn(),
    };
    await render({ ...props, threadId: '$a' });
    const listenerOfA = vi.mocked(room.on).mock.calls[0]?.[1] as unknown as (
      signalRoom: Room,
      timelineSet: EventTimelineSet
    ) => void;
    await run(signal);

    // A signal that reaches A's listener after the view moved to B, as one between B's render
    // and its commit would.
    await render({ ...props, threadId: '$b' });
    await run(() => listenerOfA(room, {} as EventTimelineSet));
    await run(() => calls[0]?.resolve(true));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('settles a failed refresh like a finished one, reruns it, and leaves no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { room, signal } = makeRoom();
      const { calls, refresh } = makeRefresh();
      await render({
        room,
        threadId: '$thread',
        liveTimelineLinked: true,
        refreshLatestThreadSlice: refresh,
        onRoomRefresh: vi.fn(),
      });

      await run(signal);
      await run(signal);
      await run(() => calls[0]?.reject(new Error('sync gap')));
      expect(refresh).toHaveBeenCalledTimes(2);

      await run(() => calls[1]?.reject(new Error('sync gap')));
      await run(signal);
      expect(refresh).toHaveBeenCalledTimes(3);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('starts nothing after unmount and removes its listener', async () => {
    const { room, signal, listenerCount } = makeRoom();
    const { calls, refresh } = makeRefresh();
    await render({
      room,
      threadId: '$thread',
      liveTimelineLinked: true,
      refreshLatestThreadSlice: refresh,
      onRoomRefresh: vi.fn(),
    });
    expect(listenerCount()).toBe(1);

    await run(signal);
    await run(signal);
    await act(async () => renderer?.unmount());
    renderer = undefined;
    expect(listenerCount()).toBe(0);

    await run(() => calls[0]?.resolve(true));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps one listener, replacing it only when an input changes', async () => {
    const { room, listenerCount } = makeRoom();
    const { refresh } = makeRefresh();
    const props = {
      room,
      threadId: '$thread',
      liveTimelineLinked: true,
      refreshLatestThreadSlice: refresh,
      onRoomRefresh: vi.fn(),
    };
    await render(props);
    await render({ ...props });
    expect(room.on).toHaveBeenCalledTimes(1);

    await render({ ...props, liveTimelineLinked: false });
    expect(room.on).toHaveBeenCalledTimes(2);
    expect(room.removeListener).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(1);
  });
});
