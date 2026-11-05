// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { atom, createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomToUnread } from '../types/room';
import { useRoomsUnread } from './useUnread';

const roomToUnreadAtom = atom<RoomToUnread>(
  new Map([
    ['!a:example.org', { total: 2, highlight: 1 }],
    ['!b:example.org', { total: 3, highlight: 0 }],
  ])
);

function Counter({ ids }: { ids: string[] }) {
  // A new array on every render, as callers that derive the ids inline pass.
  const unread = useRoomsUnread([...ids], roomToUnreadAtom);
  return <span>{unread ? `${unread.total}/${unread.highlight}` : 'none'}</span>;
}

describe('useRoomsUnread', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles when the caller passes a new array with the same rooms on every render', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(
      <Provider store={createStore()}>
        <Counter ids={['!a:example.org', '!b:example.org']} />
      </Provider>
    );
    expect(container.textContent).toBe('5/1');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
