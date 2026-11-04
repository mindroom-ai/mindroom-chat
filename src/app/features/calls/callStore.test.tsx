import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createStore, Provider } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { activeCallAtom, useCallActions, type ActiveCall } from './callStore';

const actionsIn = (store: ReturnType<typeof createStore>) => {
  let actions!: ReturnType<typeof useCallActions>;
  function Probe() {
    actions = useCallActions({} as MatrixClient);
    return null;
  }
  act(() => {
    create(
      <Provider store={store}>
        <Probe />
      </Provider>
    );
  });
  return actions;
};

describe('useCallActions endCall', () => {
  it('ends the call even when leaving it fails, so the next call can start', async () => {
    const store = createStore();
    const onEnded = vi.fn(async () => undefined);
    const active = {
      kind: 'room',
      call: { leave: vi.fn(async () => Promise.reject(new Error('LiveKit gone'))) },
      onEnded,
    } as unknown as ActiveCall;
    store.set(activeCallAtom, active);

    await expect(actionsIn(store).endCall()).rejects.toThrow('LiveKit gone');

    expect(store.get(activeCallAtom)).toBeUndefined();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});
