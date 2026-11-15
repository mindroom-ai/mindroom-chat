// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { tourAtom } from '../navigation/tourState';
import { EmptyState } from '../threads/overview/CompactRoomView.css';
import { CompactRoomWithoutThreads } from './CompactRoomWithoutThreads';

/** The start of a Compact room without threads, and the store its button writes to. */
const showRoomStart = () => {
  const store = createStore();
  const { container } = render(
    <Provider store={store}>
      <CompactRoomWithoutThreads />
    </Provider>
  );
  return { store, root: container.firstElementChild };
};

/** Whether `later` comes after `earlier` in the page. */
const follows = (earlier: Element, later: Element): boolean =>
  (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

afterEach(cleanup);

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

  it('opens the Quick tour from its button', () => {
    const { store } = showRoomStart();
    expect(store.get(tourAtom)).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'How threads work' }));

    expect(store.get(tourAtom)).toEqual({ level: 'quick' });
  });
});
