import React, { Activity } from 'react';
import { MatrixClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { MINDROOM_THREAD_TAGS_EVENT } from '../../event-store/threads/threadTags';
import { useRoomThreadResolutionMap } from '../../threads/tags/useRoomThreadTags';
import { useStateEvents } from './useStateEvents';

type Listener = (...args: unknown[]) => void;

const fakeRoom = (stateEvents: { current: MatrixEvent[] }) => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    roomId: '!room:example.org',
    getLiveTimeline: () => ({
      getState: () => ({ getStateEvents: () => stateEvents.current }),
    }),
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
  };
};

function Probe({ room, onRender }: { room: Room; onRender: (events: MatrixEvent[]) => void }) {
  onRender(useStateEvents(room, 'com.example.state'));
  return null;
}

describe('useStateEvents', () => {
  it('reads the state again when the room timeline resets, not when a thread timeline does', async () => {
    const first = [{ getId: () => '$first' } as unknown as MatrixEvent];
    const second = [{ getId: () => '$second' } as unknown as MatrixEvent];
    const state = { current: first };
    const room = fakeRoom(state);
    const rendered: MatrixEvent[][] = [];
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(Probe, {
          room: room as unknown as Room,
          onRender: (events) => rendered.push(events),
        })
      );
    });
    state.current = second;

    // The room passes on every thread's timeline resets, which happen as threads load; the room's
    // state does not live in a thread, so they leave the array, and every memo keyed on it, alone.
    await act(async () => {
      room.emit(RoomEvent.TimelineReset, room, { thread: { id: '$root' } }, false);
    });
    expect(rendered.at(-1)).toBe(first);

    // A limited sync resets the room's own timeline and with it the current state.
    await act(async () => {
      room.emit(RoomEvent.TimelineReset, room, { thread: undefined }, true);
    });
    expect(rendered.at(-1)).toBe(second);

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('re-reads room state changes that occurred while hidden in Activity so thread resolution stays fresh', async () => {
    const mx = new MatrixClient({ baseUrl: 'https://example.org', userId: '@alice:example.org' });
    const room = new Room('!room-activity:example.org', mx, '@alice:example.org');
    let renderCount = 0;
    let latestResolved = false;

    function ResolutionProbe() {
      renderCount += 1;
      const map = useRoomThreadResolutionMap(room);
      latestResolved = map.get('$t1')?.isResolved ?? false;
      return null;
    }

    const ActivityBox = Activity as React.ComponentType<{
      mode: 'visible' | 'hidden';
      children?: React.ReactNode;
    }>;

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        React.createElement(ActivityBox, { mode: 'visible' }, React.createElement(ResolutionProbe))
      );
    });
    expect(latestResolved).toBe(false);
    expect(renderCount).toBe(1);

    // Park inside Activity hidden (disconnects RoomStateEvent.Events listener).
    await act(async () => {
      renderer?.update(
        React.createElement(ActivityBox, { mode: 'hidden' }, React.createElement(ResolutionProbe))
      );
    });

    // Resolve thread $t1 while room listeners are disconnected.
    room.currentState.setStateEvents([
      new MatrixEvent({
        event_id: '$resolve-t1',
        type: MINDROOM_THREAD_TAGS_EVENT,
        room_id: room.roomId,
        state_key: '$t1',
        sender: '@alice:example.org',
        origin_server_ts: 2_000,
        content: {
          tags: {
            resolved: { set_by: '@alice:example.org', set_at: 2_000 },
          },
        },
      }),
    ]);

    // Reveal Activity: useStateEvents immediately catches the missed state event.
    await act(async () => {
      renderer?.update(
        React.createElement(ActivityBox, { mode: 'visible' }, React.createElement(ResolutionProbe))
      );
    });
    expect(latestResolved).toBe(true);

    await act(async () => {
      renderer?.unmount();
    });
  });
});
