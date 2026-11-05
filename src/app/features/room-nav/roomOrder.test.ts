import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  applyRoomOrder,
  moveRoom,
  parseRoomOrderLists,
  saveRoomOrder,
  withRoomOrder,
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

describe('withRoomOrder', () => {
  it('sets one list and keeps the other lists and unknown keys', () => {
    const content = { lists: { '!space': ['!x'] }, future: true };
    expect(withRoomOrder(content, 'home', ['!b', '!a'])).toEqual({
      lists: { '!space': ['!x'], home: ['!b', '!a'] },
      future: true,
    });
    // The stored content is not changed in place.
    expect(content).toEqual({ lists: { '!space': ['!x'] }, future: true });
  });

  it('removes a list to go back to A to Z', () => {
    expect(withRoomOrder({ lists: { home: ['!a'], '!s': ['!b'] } }, 'home', undefined)).toEqual({
      lists: { '!s': ['!b'] },
    });
  });

  it('starts from empty content', () => {
    expect(withRoomOrder(undefined, 'home', ['!a'])).toEqual({ lists: { home: ['!a'] } });
  });
});

describe('saveRoomOrder', () => {
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

  it('writes the list into io.mindroom.room_order over the stored content', async () => {
    const { client, setAccountData } = clientWith({ lists: { '!space': ['!x', '!y'] } });
    await saveRoomOrder(client, 'home', ['!c', '!a', '!b']);
    expect(setAccountData).toHaveBeenCalledWith('io.mindroom.room_order', {
      lists: { '!space': ['!x', '!y'], home: ['!c', '!a', '!b'] },
    });
  });

  it('round-trips: what it writes reads back as the same order', async () => {
    const { client, setAccountData } = clientWith(undefined);
    await saveRoomOrder(client, '!space', ['!b', '!a']);
    const written = (setAccountData.mock.calls[0] as unknown[])[1];
    expect(applyRoomOrder(['!a', '!b', '!c'], parseRoomOrderLists(written)['!space'])).toEqual([
      '!b',
      '!a',
      '!c',
    ]);
  });

  it('forgets a list when saving no order', async () => {
    const { client, setAccountData } = clientWith({ lists: { home: ['!b', '!a'] } });
    await saveRoomOrder(client, 'home', undefined);
    expect(setAccountData).toHaveBeenCalledWith('io.mindroom.room_order', { lists: {} });
  });
});
