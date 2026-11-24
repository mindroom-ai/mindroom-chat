import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import {
  appendRoomOrder,
  applyRoomOrder,
  moveRoom,
  parseRoomOrderData,
  parseRoomOrderLists,
  saveRoomOrderChanges,
  useRoomOrders,
  withRoomOrderChanges,
  type RoomOrders,
} from './roomOrder';

describe('applyRoomOrder', () => {
  it('keeps the given (A to Z) order without a saved order', () => {
    expect(applyRoomOrder(['!a', '!b', '!c'])).toEqual(['!a', '!b', '!c']);
    expect(applyRoomOrder(['!a', '!b', '!c'], [])).toEqual(['!a', '!b', '!c']);
  });

  it('shows the saved rooms in their order and puts rooms the order lacks after them', () => {
    expect(applyRoomOrder(['!a', '!b', '!c', '!d'], ['!c', '!a'])).toEqual([
      '!c',
      '!a',
      '!b',
      '!d',
    ]);
  });

  it('skips saved rooms the list no longer has', () => {
    expect(applyRoomOrder(['!a', '!b'], ['!gone', '!b', '!a'])).toEqual(['!b', '!a']);
  });
});

describe('moveRoom', () => {
  it('moves a room up to the place of the room it was dropped on', () => {
    expect(moveRoom(['!a', '!b', '!c'], '!c', 0)).toEqual(['!c', '!a', '!b']);
  });

  it('moves a room down to the place of the room it was dropped on', () => {
    expect(moveRoom(['!a', '!b', '!c'], '!a', 2)).toEqual(['!b', '!c', '!a']);
    expect(moveRoom(['!a', '!b', '!c'], '!a', 1)).toEqual(['!b', '!a', '!c']);
  });

  it('keeps the index in range and leaves an order without the room unchanged', () => {
    expect(moveRoom(['!a', '!b'], '!a', 9)).toEqual(['!b', '!a']);
    expect(moveRoom(['!a', '!b'], '!b', -3)).toEqual(['!b', '!a']);
    expect(moveRoom(['!a', '!b'], '!x', 0)).toEqual(['!a', '!b']);
  });
});

describe('appendRoomOrder', () => {
  it('preserves archived/hidden saved rooms, keeps unsaved visible rooms, and appends the moved room', () => {
    const next = appendRoomOrder(['!c', '!b', '!a'], ['!c', '!a', '!e'], '!d');
    expect(next).toEqual(['!c', '!b', '!a', '!e', '!d']);
    // Unarchiving `!b` later keeps its original saved position.
    expect(applyRoomOrder(['!a', '!b', '!c', '!d', '!e'], next)).toEqual([
      '!c',
      '!b',
      '!a',
      '!e',
      '!d',
    ]);
  });

  it('deduplicates when the moved room is already present in saved or visible rooms', () => {
    expect(appendRoomOrder(['!d', '!c', '!b', '!a'], ['!c', '!a', '!d'], '!d')).toEqual([
      '!c',
      '!b',
      '!a',
      '!d',
    ]);
  });
});

describe('parseRoomOrderLists', () => {
  it('reads each list once per room and drops malformed or empty lists', () => {
    expect(
      parseRoomOrderLists({
        lists: {
          home: ['!a', 7, '!b', '!a'],
          '!space': [],
          '!other': 'not a list',
          '!kept': ['!c'],
        },
      })
    ).toEqual({ home: ['!a', '!b'], '!kept': ['!c'] });
  });

  it('reads nothing from missing or malformed content', () => {
    expect(parseRoomOrderLists(undefined)).toEqual({});
    expect(parseRoomOrderLists({ lists: ['!a'] })).toEqual({});
    expect(parseRoomOrderLists('home')).toEqual({});
  });
});

describe('saveRoomOrderChanges', () => {
  const clientWith = (content: unknown) => {
    const setAccountData = vi.fn(async () => ({}));
    const client = {
      getAccountData: vi.fn((type: string) =>
        type === 'io.mindroom.room_order' && content !== undefined
          ? { getContent: () => content }
          : undefined
      ),
      setAccountData,
    } as unknown as MatrixClient;
    return { client, setAccountData };
  };

  it('writes changes into io.mindroom.room_order without mutating stored content and round-trips', async () => {
    const stored = { lists: { '!space': ['!x', '!y'] }, future: true };
    const { client, setAccountData } = clientWith(stored);
    await saveRoomOrderChanges(client, {
      lists: { home: ['!c', '!a', '!b'] },
      modes: { home: 'manual' },
    });
    expect(setAccountData).toHaveBeenCalledWith('io.mindroom.room_order', {
      lists: { '!space': ['!x', '!y'], home: ['!c', '!a', '!b'] },
      modes: { home: 'manual' },
      future: true,
    });
    expect(stored).toEqual({ lists: { '!space': ['!x', '!y'] }, future: true });

    const fresh = clientWith(undefined);
    await saveRoomOrderChanges(fresh.client, { lists: { '!space': ['!b', '!a'] } });
    const written = (fresh.setAccountData.mock.calls[0] as unknown[])[1];
    expect(applyRoomOrder(['!a', '!b', '!c'], parseRoomOrderLists(written)['!space'])).toEqual([
      '!b',
      '!a',
      '!c',
    ]);
  });
});

describe('useRoomOrders', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('reads all lists from one account-data subscription', () => {
    const stored = {
      lists: { '!root': ['!b', '!a'], '!sub': ['!d', '!c'] },
    };
    const event = { getContent: () => stored } as unknown as MatrixEvent;
    const on = vi.fn();
    const client = {
      getAccountData: vi.fn((type: string) =>
        type === 'io.mindroom.room_order' ? event : undefined
      ),
      setAccountData: vi.fn(async () => ({})),
      on,
      off: vi.fn(),
    } as unknown as MatrixClient;

    let orders: RoomOrders | undefined;
    const Harness = () => {
      orders = useRoomOrders();
      return null;
    };
    act(() => {
      renderer = create(
        React.createElement(MatrixClientProvider, { value: client }, React.createElement(Harness))
      );
    });

    expect(on).toHaveBeenCalledTimes(1);
    expect(orders!.modeOf('!root')).toBe('manual');
    expect(orders!.modeOf('!sub')).toBe('manual');
    expect(orders!.modeOf('!none')).toBe('name');
    expect(orders!.orderOf('!root', ['!a', '!b'])).toEqual(['!b', '!a']);
    expect(orders!.orderOf('!sub', ['!c', '!d'])).toEqual(['!d', '!c']);
  });

  it('appendRoom writes only for manual lists and preserves archived saved room IDs', () => {
    const stored = {
      lists: { '!manual': ['!c', '!b', '!a'] },
    };
    const event = { getContent: () => stored } as unknown as MatrixEvent;
    const setAccountData = vi.fn(async () => ({}));
    const client = {
      getAccountData: vi.fn((type: string) =>
        type === 'io.mindroom.room_order' ? event : undefined
      ),
      setAccountData,
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as MatrixClient;

    let orders: RoomOrders | undefined;
    const Harness = () => {
      orders = useRoomOrders();
      return null;
    };
    act(() => {
      renderer = create(
        React.createElement(MatrixClientProvider, { value: client }, React.createElement(Harness))
      );
    });

    // Non-manual lists stay in A to Z order without writing account data.
    act(() => orders!.appendRoom('!auto', ['!x'], '!d'));
    expect(setAccountData).not.toHaveBeenCalled();

    // Manual lists keep archived `!b`, add unsaved visible `!e`, and append `!d`.
    act(() => orders!.appendRoom('!manual', ['!a', '!c', '!e'], '!d'));
    expect(setAccountData).toHaveBeenCalledTimes(1);
    expect(setAccountData).toHaveBeenCalledWith('io.mindroom.room_order', {
      lists: { '!manual': ['!c', '!b', '!a', '!e', '!d'] },
    });
  });
});

describe('parseRoomOrderData & withRoomOrderChanges', () => {
  it('validates modes and showTimes, drops malformed entries, and preserves unknown keys', () => {
    expect(
      parseRoomOrderData({
        lists: { home: ['!b', '!a'] },
        modes: { home: 'manual', '!wa': 'recent', '!sub': 'inherit', '!bad': 'alpha', '!n': 1 },
        showTimes: { '!wa': true, '!sub': false, '!bad': 'yes' },
      })
    ).toEqual({
      lists: { home: ['!b', '!a'] },
      modes: { home: 'manual', '!wa': 'recent', '!sub': 'inherit' },
      showTimes: { '!wa': true, '!sub': false },
    });

    expect(
      withRoomOrderChanges(
        { lists: { home: ['!b', '!a'] }, futureKey: 42 },
        { modes: { home: 'recent' }, showTimes: { home: true } }
      )
    ).toEqual({
      lists: { home: ['!b', '!a'] },
      modes: { home: 'recent' },
      showTimes: { home: true },
      futureKey: 42,
    });

    // Removing the last entry omits empty modes/showTimes objects.
    expect(
      withRoomOrderChanges(
        { modes: { home: 'recent' }, showTimes: { home: true }, futureKey: 42 },
        { modes: { home: undefined }, showTimes: { home: undefined } }
      )
    ).toEqual({ futureKey: 42 });
  });
});

describe('useRoomOrders sort modes, showTimes, inheritance, and rollback', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const mount = (
    stored: Record<string, unknown> | undefined,
    setAccountData = vi.fn(async () => ({}))
  ) => {
    const event = stored ? ({ getContent: () => stored } as unknown as MatrixEvent) : undefined;
    const client = {
      getAccountData: vi.fn((type: string) =>
        type === 'io.mindroom.room_order' ? event : undefined
      ),
      setAccountData,
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as MatrixClient;
    let current!: RoomOrders;
    const Harness = () => {
      current = useRoomOrders();
      return null;
    };
    act(() => {
      renderer = create(
        React.createElement(MatrixClientProvider, { value: client }, React.createElement(Harness))
      );
    });
    return {
      get orders() {
        return current;
      },
      setAccountData,
    };
  };

  it('resolves legacy lists-only data as manual and defaults unset lists to name/false', () => {
    const harness = mount({ lists: { home: ['!b', '!a'] } });
    expect(harness.orders.modeOf('home')).toBe('manual');
    expect(harness.orders.hasExplicitMode('home')).toBe(true);
    expect(harness.orders.hasSavedOrder('home')).toBe(true);
    expect(harness.orders.modeOf('!fresh')).toBe('name');
    expect(harness.orders.hasExplicitMode('!fresh')).toBe(false);
    expect(harness.orders.showTimesOf('!fresh')).toBe(false);
  });

  it('preserves saved custom lists across mode switches and freezes currentOrder on first Custom switch', () => {
    const harness = mount({});

    // Recent -> Custom with no saved order freezes currentOrder.
    act(() => harness.orders.setMode('home', 'recent'));
    expect(harness.orders.modeOf('home')).toBe('recent');
    expect(harness.orders.hasSavedOrder('home')).toBe(false);

    act(() => harness.orders.setMode('home', 'manual', ['!c', '!a', '!b']));
    expect(harness.orders.modeOf('home')).toBe('manual');
    expect(harness.orders.hasSavedOrder('home')).toBe(true);
    expect(harness.orders.orderOf('home', ['!a', '!b', '!c'])).toEqual(['!c', '!a', '!b']);
    expect(harness.setAccountData).toHaveBeenLastCalledWith('io.mindroom.room_order', {
      lists: { home: ['!c', '!a', '!b'] },
      modes: { home: 'manual' },
    });

    // Switching to A to Z preserves lists.home untouched.
    act(() => harness.orders.setMode('home', 'name'));
    expect(harness.orders.modeOf('home')).toBe('name');
    expect(harness.orders.hasSavedOrder('home')).toBe(true);
    expect(harness.setAccountData).toHaveBeenLastCalledWith('io.mindroom.room_order', {
      lists: { home: ['!c', '!a', '!b'] },
      modes: { home: 'name' },
    });

    // Switching back to Custom restores saved list instead of overwriting with currentOrder.
    act(() => harness.orders.setMode('home', 'manual', ['!a', '!b', '!c']));
    expect(harness.orders.orderOf('home', ['!a', '!b', '!c'])).toEqual(['!c', '!a', '!b']);
  });

  it('save writes lists and manual mode atomically', () => {
    const harness = mount({ modes: { '!space': 'name' } });
    act(() => harness.orders.save('!space', ['!b', '!a']));
    expect(harness.orders.modeOf('!space')).toBe('manual');
    expect(harness.setAccountData).toHaveBeenCalledWith('io.mindroom.room_order', {
      lists: { '!space': ['!b', '!a'] },
      modes: { '!space': 'manual' },
    });
  });

  it('inherits mode and showTimes across parent chains and resets sub-space overrides losslessly', () => {
    const harness = mount({
      lists: { '!subWithList': ['!z', '!a'] },
      modes: { '!root': 'recent', '!subNoList': 'name' },
      showTimes: { '!root': true, '!subNoList': false },
    });

    // Un-overridden child & grandchild inherit from !root.
    expect(harness.orders.modeOf('!child', ['!root'])).toBe('recent');
    expect(harness.orders.modeOf('!grand', ['!child', '!root'])).toBe('recent');
    expect(harness.orders.showTimesOf('!grand', ['!child', '!root'])).toBe(true);
    expect(harness.orders.hasExplicitMode('!child')).toBe(false);

    // Explicit sub-space override blocks inheritance.
    expect(harness.orders.modeOf('!subNoList', ['!root'])).toBe('name');
    expect(harness.orders.showTimesOf('!subNoList', ['!root'])).toBe(false);
    expect(harness.orders.hasExplicitMode('!subNoList')).toBe(true);

    // Legacy sub-space with saved list counts as explicit manual until reset.
    expect(harness.orders.modeOf('!subWithList', ['!root'])).toBe('manual');
    expect(harness.orders.hasExplicitMode('!subWithList')).toBe(true);

    // Resetting sub-space with saved list writes "inherit" and keeps the saved list intact.
    act(() => harness.orders.resetSubspaceOverride('!subWithList'));
    expect(harness.orders.hasExplicitMode('!subWithList')).toBe(false);
    expect(harness.orders.modeOf('!subWithList', ['!root'])).toBe('recent');
    expect(harness.orders.hasSavedOrder('!subWithList')).toBe(true);
    expect(harness.setAccountData).toHaveBeenLastCalledWith('io.mindroom.room_order', {
      lists: { '!subWithList': ['!z', '!a'] },
      modes: { '!root': 'recent', '!subNoList': 'name', '!subWithList': 'inherit' },
      showTimes: { '!root': true, '!subNoList': false },
    });

    // Resetting sub-space without a saved list deletes both mode and showTimes cleanly.
    act(() => harness.orders.resetSubspaceOverride('!subNoList'));
    expect(harness.orders.hasExplicitMode('!subNoList')).toBe(false);
    expect(harness.orders.modeOf('!subNoList', ['!root'])).toBe('recent');
    expect(harness.orders.showTimesOf('!subNoList', ['!root'])).toBe(true);
    expect(harness.setAccountData).toHaveBeenLastCalledWith('io.mindroom.room_order', {
      lists: { '!subWithList': ['!z', '!a'] },
      modes: { '!root': 'recent', '!subWithList': 'inherit' },
      showTimes: { '!root': true },
    });
  });

  it('keeps root showTimes=false lean while storing explicit false when parent shows times', () => {
    const harness = mount({ showTimes: { '!root': true } });

    // Turning off showTimes on a sub-space under a parent with showTimes=true stores explicit false.
    act(() => harness.orders.setShowTimes('!sub', false, ['!root']));
    expect(harness.orders.showTimesOf('!sub', ['!root'])).toBe(false);
    expect(harness.setAccountData).toHaveBeenLastCalledWith('io.mindroom.room_order', {
      showTimes: { '!root': true, '!sub': false },
    });

    // Turning off showTimes on a root list deletes the entry instead of storing false.
    act(() => harness.orders.setShowTimes('!root', false));
    expect(harness.orders.showTimesOf('!root')).toBe(false);
    expect(harness.setAccountData).toHaveBeenLastCalledWith('io.mindroom.room_order', {
      showTimes: { '!sub': false },
    });
  });

  it('snapshots inheriting sub-spaces on first switch to Custom without breaking inheritance', () => {
    const harness = mount({
      lists: { '!savedSub': ['!p', '!q'] },
      modes: { '!root': 'recent', '!overridden': 'name', '!savedSub': 'inherit' },
    });

    // Empty root + inheriting !sub with no saved list freezes !sub with mode "inherit" atomically,
    // leaving explicitly overridden and already-saved sub-spaces untouched.
    act(() =>
      harness.orders.setMode('!root', 'manual', [], {
        '!sub': ['!zebra', '!alder'],
        '!overridden': ['!y', '!x'],
        '!savedSub': ['!q', '!p'],
        '!emptySub': [],
      })
    );
    expect(harness.setAccountData).toHaveBeenCalledTimes(1);
    expect(harness.setAccountData).toHaveBeenCalledWith('io.mindroom.room_order', {
      lists: { '!savedSub': ['!p', '!q'], '!sub': ['!zebra', '!alder'] },
      modes: {
        '!root': 'manual',
        '!overridden': 'name',
        '!savedSub': 'inherit',
        '!sub': 'inherit',
      },
    });
    expect(harness.orders.hasExplicitMode('!sub')).toBe(false);
    expect(harness.orders.modeOf('!sub', ['!root'])).toBe('manual');
    expect(harness.orders.orderOf('!sub', ['!alder', '!zebra'])).toEqual(['!zebra', '!alder']);

    // Switching root back to A to Z / Recent still carries down to !sub.
    act(() => harness.orders.setMode('!root', 'name'));
    expect(harness.orders.modeOf('!sub', ['!root'])).toBe('name');
    act(() => harness.orders.setMode('!root', 'recent'));
    expect(harness.orders.modeOf('!sub', ['!root'])).toBe('recent');
  });

  it('reverts optimistic pending state if setAccountData rejects', async () => {
    let rejectSave!: (err: Error) => void;
    const setAccountData = vi.fn(
      () =>
        new Promise<Record<string, never>>((_, reject) => {
          rejectSave = reject;
        })
    );
    const harness = mount({}, setAccountData);

    act(() => harness.orders.setMode('home', 'recent'));
    expect(harness.orders.modeOf('home')).toBe('recent');

    await act(async () => {
      rejectSave(new Error('network'));
      await Promise.resolve();
    });
    expect(harness.orders.modeOf('home')).toBe('name');
  });
});
