import React, { useEffect } from 'react';
import { RoomEvent, ThreadEvent, type Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { PaneCollapsedContext } from '../../lib/hooks/usePaneCollapsed';
import { Activity } from 'react';
import {
  useThreadOverviewListenedFirst,
  useThreadOverviewRefreshCounter,
} from './threadOverviewRefreshCounter';

const makeRoom = () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    roomId: '!room:example.org',
    on: (eventName: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(eventName) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
    },
    removeListener: (eventName: string, listener: (...args: unknown[]) => void) => {
      listeners.get(eventName)?.delete(listener);
    },
    emit: (eventName: string, ...args: unknown[]) => {
      listeners.get(eventName)?.forEach((listener) => listener(...args));
    },
  } as unknown as Room & { emit: (eventName: string, ...args: unknown[]) => void };
};

const CounterHarness = ({
  onCounter,
  room,
  threadId,
}: {
  onCounter: (counter: number) => void;
  room: ReturnType<typeof makeRoom>;
  threadId?: string;
}) => {
  const { overviewRefreshCounter } = useThreadOverviewRefreshCounter(room, threadId);
  useEffect(() => {
    onCounter(overviewRefreshCounter);
  }, [onCounter, overviewRefreshCounter]);
  return null;
};

describe('useThreadOverviewRefreshCounter', () => {
  it('bumps for room overview receipt and thread events', async () => {
    const room = makeRoom();
    const counters: number[] = [];
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(CounterHarness, {
          onCounter: (counter) => counters.push(counter),
          room,
        })
      );
    });
    await act(async () => {
      room.emit(RoomEvent.Receipt, undefined, room);
    });
    await act(async () => {
      room.emit(ThreadEvent.Update);
    });

    // The first count is the listeners' start.
    expect(counters).toEqual([0, 1, 2, 3]);

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('does not subscribe while inside a thread route', async () => {
    const room = makeRoom();
    const counters: number[] = [];

    await act(async () => {
      create(
        React.createElement(CounterHarness, {
          onCounter: (counter) => counters.push(counter),
          room,
          threadId: '$thread',
        })
      );
    });
    await act(async () => {
      room.emit(RoomEvent.Receipt, undefined, room);
      room.emit(ThreadEvent.Update);
    });

    expect(counters).toEqual([0]);
  });

  it('defers counter bumps while collapsed and flushes once on uncollapse', async () => {
    const room = makeRoom();
    const counters: number[] = [];
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        React.createElement(
          PaneCollapsedContext.Provider,
          { value: true },
          React.createElement(CounterHarness, {
            onCounter: (counter) => counters.push(counter),
            room,
          })
        )
      );
    });
    await act(async () => {
      room.emit(RoomEvent.Receipt, undefined, room);
      room.emit(ThreadEvent.Update);
    });
    expect(counters).toEqual([0]);

    await act(async () => {
      renderer?.update(
        React.createElement(
          PaneCollapsedContext.Provider,
          { value: false },
          React.createElement(CounterHarness, {
            onCounter: (counter) => counters.push(counter),
            room,
          })
        )
      );
    });
    expect(counters).toEqual([0, 0, 1]);

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('keeps useThreadOverviewListenedFirst warm across Activity hide/reveal without waiting or bumping while passive, and handles cold collapsed preview', async () => {
    const room = makeRoom();
    const seen: Array<number | 'waiting' | undefined> = [];
    function ListenedHarness() {
      const value = useThreadOverviewListenedFirst(room, undefined, true);
      seen.push(value === 'waiting' ? 'waiting' : value?.overviewRefreshCounter);
      return null;
    }

    const ActivityBox = Activity as React.ComponentType<{
      mode: 'visible' | 'hidden';
      children?: React.ReactNode;
    }>;

    let renderer: ReturnType<typeof create> | undefined;
    // 1. Warm mount -> count goes 0 (waiting) -> 1.
    await act(async () => {
      renderer = create(
        React.createElement(
          PaneCollapsedContext.Provider,
          { value: false },
          React.createElement(
            ActivityBox,
            { mode: 'visible' },
            React.createElement(ListenedHarness)
          )
        )
      );
    });
    expect(seen.at(-1)).toBe(1);

    // 2. Park in Activity hidden while collapsed.
    await act(async () => {
      renderer?.update(
        React.createElement(
          PaneCollapsedContext.Provider,
          { value: true },
          React.createElement(ActivityBox, { mode: 'hidden' }, React.createElement(ListenedHarness))
        )
      );
    });

    // 3. Reveal during passive peek: never resets to waiting, does not bump on reveal or live events.
    seen.length = 0;
    await act(async () => {
      renderer?.update(
        React.createElement(
          PaneCollapsedContext.Provider,
          { value: true },
          React.createElement(
            ActivityBox,
            { mode: 'visible' },
            React.createElement(ListenedHarness)
          )
        )
      );
      room.emit(RoomEvent.Receipt, undefined, room);
      room.emit(ThreadEvent.Update);
    });
    expect(seen).not.toContain('waiting');
    expect(seen.every((v) => v === 1)).toBe(true);

    // 4. Commit (uncollapse): flushes once to 2.
    await act(async () => {
      renderer?.update(
        React.createElement(
          PaneCollapsedContext.Provider,
          { value: false },
          React.createElement(
            ActivityBox,
            { mode: 'visible' },
            React.createElement(ListenedHarness)
          )
        )
      );
    });
    expect(seen.at(-1)).toBe(2);
    await act(async () => renderer?.unmount());

    // 5. Cold mount directly while collapsed/passive (cold-reload back-peek): transitions 0 -> 1 once
    //    so preview renders instead of staying waiting, then freezes live events until uncollapsed.
    const coldSeen: Array<number | 'waiting' | undefined> = [];
    function ColdHarness() {
      const value = useThreadOverviewListenedFirst(room, undefined, true);
      coldSeen.push(value === 'waiting' ? 'waiting' : value?.overviewRefreshCounter);
      return null;
    }
    await act(async () => {
      renderer = create(
        React.createElement(
          PaneCollapsedContext.Provider,
          { value: true },
          React.createElement(ColdHarness)
        )
      );
      room.emit(ThreadEvent.Update);
    });
    expect(coldSeen.at(-1)).toBe(1);
    await act(async () => renderer?.unmount());
  });
});
