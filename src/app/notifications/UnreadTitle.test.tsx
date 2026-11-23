// @vitest-environment jsdom
import { Provider, createStore } from 'jotai';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { UnreadTitleFeature, countRoomNotifications, titleWithCount } from './UnreadTitle';

describe('countRoomNotifications', () => {
  it('adds the rooms and skips Space totals, which repeat their rooms', () => {
    const unread = new Map([
      ['!a:x', { total: 2, highlight: 1 }],
      ['!b:x', { total: 0, highlight: 0 }],
      ['!space:x', { total: 2, highlight: 1, from: new Set(['!a:x']) }],
    ]);
    expect(countRoomNotifications(unread)).toBe(2);
  });
});

describe('titleWithCount', () => {
  it('leads with the count, capped at 99+', () => {
    expect(titleWithCount('MindRoom', 0)).toBe('MindRoom');
    expect(titleWithCount('MindRoom', 3)).toBe('(3) MindRoom');
    expect(titleWithCount('MindRoom', 120)).toBe('(99+) MindRoom');
  });
});

describe('UnreadTitleFeature', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    Reflect.deleteProperty(window, 'mindroomDesktop');
  });

  it('follows the counts and restores the title on unmount', () => {
    document.title = 'MindRoom';
    const store = createStore();
    act(() => {
      renderer = create(
        <Provider store={store}>
          <UnreadTitleFeature />
        </Provider>
      );
    });
    expect(document.title).toBe('MindRoom');

    act(() => {
      store.set(roomToUnreadAtom, {
        type: 'PUT',
        unreadInfo: { roomId: '!a:x', total: 4, highlight: 0 },
      });
    });
    expect(document.title).toBe('(4) MindRoom');

    act(() => store.set(roomToUnreadAtom, { type: 'DELETE', roomId: '!a:x' }));
    expect(document.title).toBe('MindRoom');

    act(() => {
      store.set(roomToUnreadAtom, {
        type: 'PUT',
        unreadInfo: { roomId: '!a:x', total: 1, highlight: 1 },
      });
    });
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(document.title).toBe('MindRoom');
  });

  it('updates the desktop Dock badge and clears it to 0 on unmount', () => {
    const setBadge = vi.fn();
    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: { setBadge },
    });
    const store = createStore();
    act(() => {
      renderer = create(
        <Provider store={store}>
          <UnreadTitleFeature />
        </Provider>
      );
    });
    expect(setBadge).toHaveBeenLastCalledWith(0);

    act(() => {
      store.set(roomToUnreadAtom, {
        type: 'PUT',
        unreadInfo: { roomId: '!a:x', total: 5, highlight: 1 },
      });
    });
    expect(setBadge).toHaveBeenLastCalledWith(5);

    act(() => {
      store.set(roomToUnreadAtom, {
        type: 'PUT',
        unreadInfo: { roomId: '!b:x', total: 100, highlight: 0 },
      });
    });
    expect(setBadge).toHaveBeenLastCalledWith(105);

    act(() => renderer?.unmount());
    renderer = undefined;
    expect(setBadge).toHaveBeenLastCalledWith(0);
  });
});
