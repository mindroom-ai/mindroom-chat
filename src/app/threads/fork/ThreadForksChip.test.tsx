// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadForksChip } from './ThreadForksChip';

const navigation = vi.hoisted(() => ({ navigateRoomThread: vi.fn() }));
// The trap wants a tabbable node, which the stand-in menu of a DOM test has too few of.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../navigation/useRoomNavigate', () => ({ useRoomNavigate: () => navigation }));
vi.mock('../../event-store/sdk/cachedThreadRoots', () => ({
  useCachedThreadRoot: () => undefined,
}));
vi.mock('../../i18n/useRelativeTime', () => ({
  useRelativeTime: (ts: number | undefined) => `t${ts}`,
}));
vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return {
    useTranslation: () => ({ i18n: { language: 'en' }, t: translateFromEn }),
  };
});

const ROOM = '!room:example.org';
const rootOf = (id: string, body: string) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    sender: '@maya:example.org',
    type: 'm.room.message',
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body },
  });
const roots: Record<string, MatrixEvent> = {
  $f1: rootOf('$f1', 'Lisbon by train'),
  $f2: rootOf('$f2', 'Lisbon by plane'),
};
const room = {
  roomId: ROOM,
  getThread: () => null,
  findEventById: (id: string) => roots[id],
  getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
  hasEncryptionStateEvent: () => false,
  getMember: () => null,
} as unknown as Room;

afterEach(cleanup);

describe('ThreadForksChip', () => {
  it('reads 1 fork for one and 2 forks for two', () => {
    const { rerender } = render(
      <ThreadForksChip room={room} forks={[{ threadId: '$f1', ts: 10 }]} />
    );
    expect(screen.getByRole('button').textContent).toBe('1 fork');
    rerender(
      <ThreadForksChip
        room={room}
        forks={[
          { threadId: '$f1', ts: 10 },
          { threadId: '$f2', ts: 20 },
        ]}
      />
    );
    expect(screen.getByRole('button').textContent).toBe('2 forks');
  });

  it('lists each fork with its title and time, and opens the one chosen', () => {
    render(
      <ThreadForksChip
        room={room}
        forks={[
          { threadId: '$f1', ts: 10 },
          { threadId: '$f2', ts: 20 },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '2 forks' }));

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Lisbon by traint10',
      'Lisbon by planet20',
    ]);

    fireEvent.click(items[1]!);
    expect(navigation.navigateRoomThread).toHaveBeenCalledWith(ROOM, '$f2');
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });
});
