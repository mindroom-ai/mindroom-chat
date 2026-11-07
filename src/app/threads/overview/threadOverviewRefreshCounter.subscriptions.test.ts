import React from 'react';
import { MatrixEventEvent, RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { useThreadOverviewRefreshCounter } from './threadOverviewRefreshCounter';

type Listener = (...args: unknown[]) => void;

const OVERVIEW_EVENTS = [
  RoomEvent.Timeline,
  RoomEvent.Receipt,
  ThreadEvent.New,
  ThreadEvent.Update,
  ThreadEvent.NewReply,
  ThreadEvent.Delete,
];

const fakeEmitter = () => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on: (name: string, listener: Listener) => {
      const named = listeners.get(name) ?? new Set<Listener>();
      named.add(listener);
      listeners.set(name, named);
    },
    removeListener: (name: string, listener: Listener) => {
      listeners.get(name)?.delete(listener);
    },
    emit: (name: string, ...args: unknown[]) => {
      [...(listeners.get(name) ?? [])].forEach((listener) => listener(...args));
    },
    count: (name: string) => listeners.get(name)?.size ?? 0,
  };
};

const fakeRoom = (roomId: string) => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    roomId,
    client: fakeEmitter(),
    on: (name: string, listener: Listener) => {
      const named = listeners.get(name) ?? new Set<Listener>();
      named.add(listener);
      listeners.set(name, named);
    },
    removeListener: (name: string, listener: Listener) => {
      listeners.get(name)?.delete(listener);
    },
    emit: (name: string, ...args: unknown[]) => {
      [...(listeners.get(name) ?? [])].forEach((listener) => listener(...args));
    },
    listenerCounts: () => OVERVIEW_EVENTS.map((name) => listeners.get(name)?.size ?? 0),
  };
};
type FakeRoom = ReturnType<typeof fakeRoom>;

const fakeEvent = (eventId: string, threadRootId?: string, roomId = '!room:example.org') => ({
  getId: () => eventId,
  getRoomId: () => roomId,
  isThreadRoot: false,
  threadRootId,
  getAssociatedId: () => undefined,
  getRelation: () => null,
});

type CounterState = ReturnType<typeof useThreadOverviewRefreshCounter>;

function Probe({
  room,
  threadId,
  onRender,
}: {
  room: FakeRoom;
  threadId?: string;
  onRender: (state: CounterState) => void;
}) {
  onRender(useThreadOverviewRefreshCounter(room as unknown as Room, threadId));
  return null;
}

const renderCounter = async (room: FakeRoom, threadId?: string) => {
  const states: CounterState[] = [];
  const element = (nextRoom: FakeRoom, nextThreadId?: string) =>
    React.createElement(Probe, {
      room: nextRoom,
      threadId: nextThreadId,
      onRender: (state) => states.push(state),
    });
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(element(room, threadId));
  });
  return {
    counter: () => states.at(-1)?.overviewRefreshCounter,
    setters: () => new Set(states.map((state) => state.setOverviewRefreshCounter)),
    rerender: (nextRoom: FakeRoom, nextThreadId?: string) =>
      act(async () => {
        renderer?.update(element(nextRoom, nextThreadId));
      }),
    emit: (target: FakeRoom, name: string, ...args: unknown[]) =>
      act(async () => {
        target.emit(name, ...args);
      }),
    unmount: () =>
      act(async () => {
        renderer?.unmount();
      }),
  };
};

describe('useThreadOverviewRefreshCounter subscriptions', () => {
  // Regression (P2-e2ee-F005): WebKit decrypted a thread's newest reply after the cards were drawn,
  // and the card kept an older reply's preview for good.
  it('counts a thread event of this room that decrypts, once per batch', async () => {
    const room = fakeRoom('!room:example.org');
    const view = await renderCounter(room);

    await act(async () => {
      room.client.emit(MatrixEventEvent.Decrypted, fakeEvent('$reply', '$root'));
      room.client.emit(MatrixEventEvent.Decrypted, fakeEvent('$edit', '$root'));
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(view.counter()).toBe(1);

    await act(async () => {
      room.client.emit(MatrixEventEvent.Decrypted, fakeEvent('$plain'));
      room.client.emit(
        MatrixEventEvent.Decrypted,
        fakeEvent('$other', '$root', '!other:example.org')
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(view.counter()).toBe(1);

    await view.unmount();
    expect(room.client.count(MatrixEventEvent.Decrypted)).toBe(0);
  });

  it('counts added timeline events of this room that concern a thread', async () => {
    const room = fakeRoom('!room:example.org');
    const other = fakeRoom('!other:example.org');
    const view = await renderCounter(room);
    const reply = fakeEvent('$reply', '$root');

    await view.emit(room, RoomEvent.Timeline, reply, room, false, false, {});
    expect(view.counter()).toBe(1);

    await view.emit(room, RoomEvent.Timeline, reply, room, false, true, {});
    await view.emit(room, RoomEvent.Timeline, reply, other, false, false, {});
    await view.emit(room, RoomEvent.Timeline, reply, undefined, false, false, {});
    await view.emit(room, RoomEvent.Timeline, fakeEvent('$plain'), room, false, false, {});
    expect(view.counter()).toBe(1);

    // Older events that pagination adds at the start count like live ones.
    await view.emit(room, RoomEvent.Timeline, fakeEvent('$older', '$root'), room, true, false, {});
    expect(view.counter()).toBe(2);

    await view.unmount();
  });

  it('ignores receipts of other rooms', async () => {
    const room = fakeRoom('!room:example.org');
    const view = await renderCounter(room);

    await view.emit(room, RoomEvent.Receipt, {}, fakeRoom('!other:example.org'));
    await view.emit(room, RoomEvent.Receipt);
    expect(view.counter()).toBe(0);

    await view.emit(room, RoomEvent.Receipt, {}, room);
    expect(view.counter()).toBe(1);

    await view.unmount();
  });

  it('counts each new thread, new reply and deleted thread, also within one task', async () => {
    const room = fakeRoom('!room:example.org');
    const view = await renderCounter(room);

    await view.emit(room, ThreadEvent.New);
    expect(view.counter()).toBe(1);
    await view.emit(room, ThreadEvent.NewReply);
    expect(view.counter()).toBe(2);
    await view.emit(room, ThreadEvent.Delete);
    expect(view.counter()).toBe(3);

    await act(async () => {
      room.emit(ThreadEvent.New);
      room.emit(ThreadEvent.Update);
      room.emit(ThreadEvent.NewReply);
    });
    expect(view.counter()).toBe(6);

    await view.unmount();
  });

  it('stops listening inside a thread and resumes from the same count after it', async () => {
    const room = fakeRoom('!room:example.org');
    const view = await renderCounter(room);
    expect(room.listenerCounts()).toEqual([1, 1, 1, 1, 1, 1]);

    await view.emit(room, ThreadEvent.Update);
    await view.rerender(room, '$thread');
    expect(room.listenerCounts()).toEqual([0, 0, 0, 0, 0, 0]);

    await view.emit(room, ThreadEvent.Update);
    await view.emit(room, RoomEvent.Receipt, {}, room);
    expect(view.counter()).toBe(1);

    await view.rerender(room, undefined);
    expect(room.listenerCounts()).toEqual([1, 1, 1, 1, 1, 1]);
    await view.emit(room, ThreadEvent.Update);
    expect(view.counter()).toBe(2);

    await view.unmount();
    expect(room.listenerCounts()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('moves the listeners to a new room and keeps the count', async () => {
    const first = fakeRoom('!first:example.org');
    const second = fakeRoom('!second:example.org');
    const view = await renderCounter(first);

    await view.emit(first, ThreadEvent.NewReply);
    await view.rerender(second);
    expect(first.listenerCounts()).toEqual([0, 0, 0, 0, 0, 0]);
    expect(second.listenerCounts()).toEqual([1, 1, 1, 1, 1, 1]);
    expect(view.counter()).toBe(1);

    await view.emit(first, ThreadEvent.NewReply);
    expect(view.counter()).toBe(1);
    await view.emit(second, RoomEvent.Receipt, {}, second);
    expect(view.counter()).toBe(2);

    await view.unmount();
  });

  it('keeps one setter, through which callers can ask for a recompute', async () => {
    const room = fakeRoom('!room:example.org');
    const view = await renderCounter(room);

    await view.emit(room, ThreadEvent.Update);
    await view.rerender(room, '$thread');
    await view.rerender(room, undefined);
    const [setter, ...others] = view.setters();
    expect(others).toEqual([]);

    await act(async () => {
      setter?.((value) => value + 1);
    });
    expect(view.counter()).toBe(2);

    await view.unmount();
  });
});
