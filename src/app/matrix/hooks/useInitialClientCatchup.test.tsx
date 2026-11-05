// @vitest-environment jsdom

import { useLayoutEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ClientEvent, MatrixClient, SyncState, SyncStateData } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInitialClientCatchup } from './useInitialClientCatchup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SyncListener = (state: SyncState, previous: SyncState | null, data?: SyncStateData) => void;

/** A client stand-in with the sync surface the hook reads; `emit` delivers a sync event. */
const createClient = (
  initialState: SyncState | null,
  initialData: SyncStateData | null = null,
  { withSyncStateData = true } = {}
) => {
  let state = initialState;
  let data = initialData;
  const listeners = new Set<SyncListener>();
  const client = {
    getSyncState: vi.fn(() => state),
    ...(withSyncStateData ? { getSyncStateData: vi.fn(() => data) } : {}),
    on: vi.fn((event: ClientEvent, listener: SyncListener) => {
      if (event === ClientEvent.Sync) listeners.add(listener);
    }),
    removeListener: vi.fn((event: ClientEvent, listener: SyncListener) => {
      if (event === ClientEvent.Sync) listeners.delete(listener);
    }),
  };
  return {
    mx: client as unknown as MatrixClient,
    client,
    listeners,
    /** Changes the client's state without an event, as if it happened while nobody listened. */
    change(nextState: SyncState, nextData: SyncStateData | null = null) {
      state = nextState;
      data = nextData;
    },
    emit(nextState: SyncState, nextData?: SyncStateData) {
      const previous = state;
      state = nextState;
      data = nextData ?? null;
      listeners.forEach((listener) => listener(nextState, previous, nextData));
    },
  };
};

function CatchupProbe({ mx, answers }: { mx: MatrixClient | undefined; answers: boolean[] }) {
  const catchingUp = useInitialClientCatchup(mx);
  answers.push(catchingUp);
  return null;
}

/** Runs `change` after the render commits but before passive effects subscribe. */
function BeforeSubscribe({ change }: { change: () => void }) {
  useLayoutEffect(change, [change]);
  return null;
}

describe('useInitialClientCatchup', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let answers: boolean[];

  const show = (mx: MatrixClient | undefined) => {
    act(() => {
      root.render(<CatchupProbe mx={mx} answers={answers} />);
    });
  };
  const latest = () => answers[answers.length - 1];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
    answers = [];
  });

  afterEach(() => {
    if (mounted) {
      act(() => {
        root.unmount();
      });
    }
    container.remove();
  });

  it('is catching up without a client', () => {
    show(undefined);

    expect(answers).toEqual([true]);
  });

  it.each([
    ['not started', null, null, true],
    ['prepared', SyncState.Prepared, null, true],
    ['catching up after a lost connection', SyncState.Catchup, null, true],
    ['syncing while draining queued messages', SyncState.Syncing, { catchingUp: true }, true],
    ['syncing with the flag off', SyncState.Syncing, { catchingUp: false }, false],
    ['syncing without data', SyncState.Syncing, null, false],
    ['reconnecting', SyncState.Reconnecting, null, false],
    ['failing', SyncState.Error, null, false],
    ['stopped', SyncState.Stopped, null, false],
  ] satisfies [string, SyncState | null, SyncStateData | null, boolean][])(
    'answers from the first render when the client is %s',
    (_name, state, data, expected) => {
      show(createClient(state, data).mx);

      expect(answers[0]).toBe(expected);
      expect(latest()).toBe(expected);
    }
  );

  it('counts a client without getSyncStateData as having no flag', () => {
    const fake = createClient(
      SyncState.Syncing,
      { catchingUp: true },
      { withSyncStateData: false }
    );
    show(fake.mx);

    expect(latest()).toBe(false);
  });

  it('follows sync events and turns true again when a later sync catches up', () => {
    const fake = createClient(SyncState.Prepared);
    show(fake.mx);
    expect(latest()).toBe(true);

    act(() => fake.emit(SyncState.Syncing));
    expect(latest()).toBe(false);

    act(() => fake.emit(SyncState.Syncing, { catchingUp: true }));
    expect(latest()).toBe(true);

    act(() => fake.emit(SyncState.Syncing, {}));
    expect(latest()).toBe(false);

    act(() => fake.emit(SyncState.Catchup));
    expect(latest()).toBe(true);
  });

  it('takes the state from the event even when the getter lags behind', () => {
    const fake = createClient(SyncState.Prepared);
    show(fake.mx);
    const [listener] = fake.listeners;

    // Like the room timeline harness: the getter keeps answering PREPARED, and the event comes
    // without data.
    act(() => listener?.(SyncState.Syncing, SyncState.Prepared));

    expect(fake.client.getSyncState()).toBe(SyncState.Prepared);
    expect(latest()).toBe(false);
  });

  it('notices a change between the first render and the listener registration', () => {
    const fake = createClient(SyncState.Prepared);
    const change = () => fake.change(SyncState.Syncing);

    act(() => {
      root.render(
        <>
          <CatchupProbe mx={fake.mx} answers={answers} />
          <BeforeSubscribe change={change} />
        </>
      );
    });

    expect(answers[0]).toBe(true);
    expect(latest()).toBe(false);
    expect(fake.client.on).toHaveBeenCalledOnce();
  });

  it('moves the listener to a new client and answers from its state in the same render', () => {
    const first = createClient(SyncState.Prepared);
    const second = createClient(SyncState.Syncing);
    show(first.mx);
    expect(latest()).toBe(true);
    const [firstListener] = first.listeners;

    const rendersBeforeSwitch = answers.length;
    show(second.mx);

    expect(answers.slice(rendersBeforeSwitch)).toEqual([false]);
    expect(first.client.removeListener).toHaveBeenCalledWith(ClientEvent.Sync, firstListener);
    expect(first.listeners.size).toBe(0);
    expect(second.client.on).toHaveBeenCalledOnce();
    expect(second.listeners.size).toBe(1);

    // The first client's events no longer count.
    act(() => first.emit(SyncState.Catchup));
    expect(latest()).toBe(false);
    act(() => second.emit(SyncState.Catchup));
    expect(latest()).toBe(true);
  });

  it('reads a client afresh when it comes back after a time without one', () => {
    const fake = createClient(SyncState.Prepared);
    show(fake.mx);
    act(() => fake.emit(SyncState.Syncing));
    expect(latest()).toBe(false);

    show(undefined);
    expect(latest()).toBe(true);
    // No client, no listener.
    expect(fake.listeners.size).toBe(0);
    expect(fake.client.on).toHaveBeenCalledOnce();
    // Missed while nobody listened.
    fake.change(SyncState.Catchup);

    show(fake.mx);
    expect(latest()).toBe(true);
    expect(fake.client.on).toHaveBeenCalledTimes(2);
  });

  it('keeps one listener across re-renders and removes it on unmount', () => {
    const fake = createClient(SyncState.Syncing);
    show(fake.mx);
    show(fake.mx);
    show(fake.mx);

    expect(fake.client.on).toHaveBeenCalledOnce();
    expect(fake.client.removeListener).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    mounted = false;

    expect(fake.client.removeListener).toHaveBeenCalledOnce();
    expect(fake.listeners.size).toBe(0);
  });

  it('does not re-render for sync events that leave the answer as it was', () => {
    const fake = createClient(SyncState.Prepared);
    show(fake.mx);
    act(() => fake.emit(SyncState.Syncing));
    const rendersWhileSynced = answers.length;

    act(() => {
      fake.emit(SyncState.Syncing);
      fake.emit(SyncState.Syncing, {});
    });
    act(() => fake.emit(SyncState.Syncing));
    act(() => fake.emit(SyncState.Reconnecting, undefined));

    expect(answers).toHaveLength(rendersWhileSynced);

    act(() => fake.emit(SyncState.Catchup));
    expect(answers).toHaveLength(rendersWhileSynced + 1);
    expect(latest()).toBe(true);
  });
});
