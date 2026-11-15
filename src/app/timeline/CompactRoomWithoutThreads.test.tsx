// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tourAtom } from '../navigation/tourState';
import { EmptyState } from '../threads/overview/CompactRoomView.css';
import { CompactRoomWithoutThreads } from './CompactRoomWithoutThreads';

// Whether the person may send the event asked about and whether the room was upgraded, which
// the test sets.
const may = vi.hoisted(() => ({ send: true, upgraded: false, asked: [] as string[] }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getSafeUserId: () => '@me:example.org' }),
}));
vi.mock('../matrix/hooks/usePowerLevels', () => ({ usePowerLevelsContext: () => ({}) }));
vi.mock('../matrix/hooks/useRoomCreators', () => ({ useRoomCreators: () => new Set() }));
vi.mock('../matrix/hooks/useStateEvent', () => ({
  useStateEvent: (_room: unknown, type: string) =>
    type === 'm.room.tombstone' && may.upgraded ? {} : undefined,
}));
vi.mock('../matrix/hooks/useRoomPermissions', () => ({
  useRoomPermissions: () => ({
    event: (type: string, userId: string) => {
      may.asked.push(`${type} ${userId}`);
      return may.send;
    },
  }),
}));

/** The start of a Compact room without threads, and the store its button writes to. */
const showRoomStart = () => {
  const store = createStore();
  const { container } = render(
    <Provider store={store}>
      <CompactRoomWithoutThreads room={{ roomId: '!room:example.org' } as Room} />
    </Provider>
  );
  return { store, root: container.firstElementChild };
};

/** Whether `later` comes after `earlier` in the page. */
const follows = (earlier: Element, later: Element): boolean =>
  (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

afterEach(() => {
  cleanup();
  may.send = true;
  may.upgraded = false;
  may.asked = [];
});

describe('CompactRoomWithoutThreads', () => {
  it('says there is no thread, how to start one, and offers the tour, in that order', () => {
    const { root } = showRoomStart();
    expect(root?.hasAttribute('data-compact-room-without-threads')).toBe(true);
    const box = root?.getElementsByClassName(EmptyState)[0];

    const none = screen.getByText('No threads');
    const hint = screen.getByText('Send a message below to start one.');
    const tour = screen.getByRole('button', { name: 'How threads work' });
    [none, hint, tour].forEach((part) => expect(box?.contains(part)).toBe(true));
    expect(follows(none, hint)).toBe(true);
    expect(follows(hint, tour)).toBe(true);
    expect(tour.getAttribute('data-tour-entry')).toBe('empty-room');
  });

  it('does not point someone who may not send messages at the composer', () => {
    may.send = false;
    showRoomStart();
    expect(may.asked).toEqual(['m.room.message @me:example.org']);
    expect(screen.getByText('No threads')).toBeTruthy();
    expect(screen.queryByText('Send a message below to start one.')).toBeNull();
    // How threads work is worth knowing all the same.
    expect(screen.getByRole('button', { name: 'How threads work' })).toBeTruthy();
  });

  it('does not point at the composer of an upgraded room, which shows none', () => {
    may.upgraded = true;
    showRoomStart();
    expect(screen.getByText('No threads')).toBeTruthy();
    expect(screen.queryByText('Send a message below to start one.')).toBeNull();
    expect(screen.getByRole('button', { name: 'How threads work' })).toBeTruthy();
  });

  it('opens the Quick tour from its button', () => {
    const { store } = showRoomStart();
    expect(store.get(tourAtom)).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'How threads work' }));

    expect(store.get(tourAtom)).toEqual({ level: 'quick' });
  });
});
