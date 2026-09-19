import React from 'react';
import { EventEmitter } from 'events';
import { Provider, createStore } from 'jotai';
import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { useRoomArchiveAction } from './useRoomArchiveAction';
import { allRoomsAtom } from '../../state/room-list/roomList';
import {
  archivedRoomsAtom,
  navigationRoomsAtom,
  joinedArchivedRoomsAtom,
  readArchivedRooms,
  setRoomArchived,
  useBindArchivedRoomsAtom,
  useVisibleRooms,
} from './archivedRooms';

const eventType = 'io.mindroom.archived_rooms';
const makeClient = (initial: Record<string, unknown> = {}) => {
  let content = initial;
  const emitter = new EventEmitter();
  const setAccountData = vi.fn(async (type: string, next: Record<string, unknown>) => {
    content = next;
    emitter.emit(ClientEvent.AccountData, new MatrixEvent({ type, content }));
    return {};
  });
  const mx = Object.assign(emitter, {
    getAccountData: () => ({ getContent: () => content }),
    setAccountData,
  }) as unknown as MatrixClient;
  return { mx, setAccountData };
};

function Bind({ mx }: { mx: MatrixClient }) {
  useBindArchivedRoomsAtom(mx);
  return null;
}

describe('archived rooms', () => {
  it('updates an existing navigation list when rooms are archived or restored', () => {
    const store = createStore();
    const rooms = ['!a:test', '!b:test'];
    let visible: string[] = [];
    function Navigation() {
      visible = useVisibleRooms(rooms);
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <Navigation />
        </Provider>
      );
    });
    expect(visible).toEqual(['!a:test', '!b:test']);
    act(() => {
      store.set(archivedRoomsAtom, new Set(['!a:test']));
    });
    expect(visible).toEqual(['!b:test']);
    act(() => {
      store.set(archivedRoomsAtom, new Set());
    });
    expect(visible).toEqual(['!a:test', '!b:test']);
    expect(rooms).toEqual(['!a:test', '!b:test']);
    act(() => renderer.unmount());
  });
  it('ignores malformed account data and deduplicates room IDs', () => {
    expect([...readArchivedRooms(null)]).toEqual([]);
    expect([...readArchivedRooms({ rooms: 'bad' })]).toEqual([]);
    expect([...readArchivedRooms({ rooms: ['!a:test', 2, null, '', '!a:test'] })]).toEqual([
      '!a:test',
    ]);
  });

  it('hides archived rooms from navigation without removing joined membership', () => {
    const store = createStore();
    store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: ['!a:test', '!b:test'] });
    store.set(archivedRoomsAtom, new Set(['!a:test', '!left:test']));
    expect(store.get(navigationRoomsAtom)).toEqual(['!b:test']);
    expect(store.get(joinedArchivedRoomsAtom)).toEqual(['!a:test']);
    expect(store.get(allRoomsAtom)).toEqual(['!a:test', '!b:test']);
    store.set(archivedRoomsAtom, new Set());
    expect(store.get(navigationRoomsAtom)).toEqual(['!a:test', '!b:test']);
  });

  it('serializes archive and restore writes without losing other rooms or unknown fields', async () => {
    const { mx, setAccountData } = makeClient({ rooms: ['!old:test'], future: 'keep' });
    await Promise.all([
      setRoomArchived(mx, '!a:test', true),
      setRoomArchived(mx, '!b:test', true),
      setRoomArchived(mx, '!old:test', false),
    ]);
    expect(setAccountData).toHaveBeenLastCalledWith(eventType, {
      rooms: ['!a:test', '!b:test'],
      future: 'keep',
    });
  });

  it('keeps failed writes out of state and permits retry', async () => {
    const { mx, setAccountData } = makeClient({ rooms: ['!old:test'] });
    setAccountData.mockRejectedValueOnce(new Error('offline'));
    await expect(setRoomArchived(mx, '!a:test', true)).rejects.toThrow('offline');
    expect([...readArchivedRooms(mx.getAccountData(eventType as any)?.getContent())]).toEqual([
      '!old:test',
    ]);
    await setRoomArchived(mx, '!b:test', true);
    expect(setAccountData).toHaveBeenLastCalledWith(eventType, {
      rooms: ['!old:test', '!b:test'],
    });
  });

  it('hydrates saved archives, reacts to remote updates, and resets on account switch', async () => {
    const store = createStore();
    const { mx } = makeClient({ rooms: ['!saved:test'] });
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <Bind mx={mx} />
        </Provider>
      );
    });
    expect([...store.get(archivedRoomsAtom)]).toEqual(['!saved:test']);
    act(() => {
      mx.emit(ClientEvent.AccountData, new MatrixEvent({ type: 'unrelated', content: {} }));
    });
    expect([...store.get(archivedRoomsAtom)]).toEqual(['!saved:test']);
    await act(async () => {
      await setRoomArchived(mx, '!new:test', true);
    });
    expect([...store.get(archivedRoomsAtom)]).toEqual(['!saved:test', '!new:test']);
    const other = makeClient().mx;
    act(() => {
      renderer.update(
        <Provider store={store}>
          <Bind mx={other} />
        </Provider>
      );
    });
    expect([...store.get(archivedRoomsAtom)]).toEqual([]);
    expect(mx.listenerCount(ClientEvent.AccountData)).toBe(0);
    act(() => renderer.unmount());
    expect(other.listenerCount(ClientEvent.AccountData)).toBe(0);
  });
});

describe('archive action feedback', () => {
  it('blocks duplicate clicks, reports failure, and permits a successful retry', async () => {
    const { mx, setAccountData } = makeClient();
    const done = vi.fn();
    let rejectWrite!: (error: Error) => void;
    setAccountData.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectWrite = reject;
        })
    );
    let action!: ReturnType<typeof useRoomArchiveAction>;
    function Action() {
      useBindArchivedRoomsAtom(mx);
      action = useRoomArchiveAction('!a:test', done);
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Provider>
          <MatrixClientProvider value={mx}>
            <Action />
          </MatrixClientProvider>
        </Provider>
      );
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = action.toggle();
      await action.toggle();
    });
    expect(action.busy).toBe(true);
    expect(setAccountData).toHaveBeenCalledTimes(1);
    await act(async () => {
      rejectWrite(new Error('offline'));
      await pending;
    });
    expect(action.failed).toBe(true);
    expect(action.busy).toBe(false);
    expect(action.archived).toBe(false);
    expect(done).not.toHaveBeenCalled();
    await act(async () => {
      await action.toggle();
    });
    expect(action.failed).toBe(false);
    expect(action.archived).toBe(true);
    expect(done).toHaveBeenCalledTimes(1);
    await act(async () => {
      await action.toggle();
    });
    expect(action.archived).toBe(false);
    expect(setAccountData).toHaveBeenLastCalledWith(eventType, { rooms: [] });
    act(() => renderer.unmount());
  });
});
