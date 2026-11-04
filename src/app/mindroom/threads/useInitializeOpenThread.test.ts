import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { ThreadEvent, type Room, type Thread } from 'matrix-js-sdk';
import { useInitializeOpenThread } from './useInitializeOpenThread';

const makeThread = (id: string) => ({ id, initialize: vi.fn() });

const makeRoom = (threads: Record<string, ReturnType<typeof makeThread>>) => {
  const room = new EventEmitter() as EventEmitter & { getThread: (id: string) => unknown };
  room.getThread = (id: string) => threads[id] ?? null;
  return room;
};

const render = (room: unknown, threadId: string | undefined): ReactTestRenderer => {
  function Probe() {
    useInitializeOpenThread(room as Room, threadId);
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(Probe));
  });
  return renderer as ReactTestRenderer;
};

describe('useInitializeOpenThread', () => {
  it('initializes the open thread when its model already exists', () => {
    const thread = makeThread('$root');
    const renderer = render(makeRoom({ $root: thread }), '$root');
    expect(thread.initialize).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it("initializes the open thread's model when the SDK creates it later, and no other", () => {
    const threads: Record<string, ReturnType<typeof makeThread>> = {};
    const room = makeRoom(threads);
    const renderer = render(room, '$root');
    const other = makeThread('$other');
    const created = makeThread('$root');
    act(() => {
      room.emit(ThreadEvent.New, other as unknown as Thread, false);
      room.emit(ThreadEvent.New, created as unknown as Thread, false);
    });
    expect(other.initialize).not.toHaveBeenCalled();
    expect(created.initialize).toHaveBeenCalledTimes(1);

    act(() => renderer.unmount());
    expect(room.listenerCount(ThreadEvent.New)).toBe(0);
  });

  it('does nothing without an open thread', () => {
    const room = makeRoom({});
    const renderer = render(room, undefined);
    expect(room.listenerCount(ThreadEvent.New)).toBe(0);
    act(() => renderer.unmount());
  });
});
