import React from 'react';
import { Provider, createStore } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { AutoDiscoveryInfoProvider } from '../../matrix/hooks/useAutoDiscoveryInfo';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { useServerEmojiRoom } from './useServerEmojiRoom';

type StateEvent = { getType: () => string };

describe('useServerEmojiRoom renders', () => {
  it('only for the state that decides which room an address names, not for member events', async () => {
    const listeners = new Set<(event: StateEvent) => void>();
    const client = {
      getRooms: () => [],
      getRoom: () => null,
      on: (_name: string, listener: (event: StateEvent) => void) => listeners.add(listener),
      removeListener: (_name: string, listener: (event: StateEvent) => void) =>
        listeners.delete(listener),
    } as unknown as MatrixClient;
    let renders = 0;
    const Probe = () => {
      renders += 1;
      useServerEmojiRoom();
      return null;
    };
    const emit = (type: string) =>
      act(async () => {
        listeners.forEach((listener) => listener({ getType: () => type }));
      });

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          MatrixClientProvider,
          { value: client },
          React.createElement(
            AutoDiscoveryInfoProvider,
            { value: { 'io.mindroom.emoji': { room: '#emoji:example.com' } } as never },
            React.createElement(Provider, { store: createStore() }, React.createElement(Probe))
          )
        )
      );
    });
    const afterMount = renders;

    await emit('m.room.member');
    await emit('m.room.member');
    expect(renders).toBe(afterMount);

    await emit('m.room.canonical_alias');
    expect(renders).toBe(afterMount + 1);
    act(() => renderer.unmount());
  });
});
