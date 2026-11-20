// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import type FocusTrap from 'focus-trap-react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userRoomProfileAtom } from '../../navigation/userRoomProfile';
import { UserRoomProfileRenderer } from './UserRoomProfileRenderer';

// The real trap; jsdom lays nothing out, so every element counts as shown.
vi.mock('focus-trap-react', async (original) => {
  const { default: RealTrap } = await original<{ default: typeof FocusTrap }>();
  return {
    default: ({ focusTrapOptions, ...props }: ComponentProps<typeof FocusTrap>) => (
      <RealTrap
        {...props}
        focusTrapOptions={{ ...focusTrapOptions, tabbableOptions: { displayCheck: 'none' } }}
      />
    ),
  };
});
const room = vi.hoisted(() => ({ roomId: '!room:x' }));
vi.mock('../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getUserId: () => '@me:x', getRoom: () => room }),
}));
vi.mock('./UserRoomProfile', () => ({
  useProfileName: (_room: unknown, userId: string) => ({ name: userId }),
  ProfileCard: ({ userId }: { userId: string }) => <button type="button">{userId}</button>,
}));

const show = (userId: string) => ({
  roomId: room.roomId,
  userId,
  cords: { x: 0, y: 0, width: 1, height: 1 },
});

const open = () => {
  const store = createStore();
  render(
    <Provider store={store}>
      <button type="button">Outside</button>
      <UserRoomProfileRenderer />
    </Provider>
  );
  act(() => store.set(userRoomProfileAtom, show('@alice:x')));
  return store;
};

afterEach(cleanup);

describe('UserRoomProfileRenderer', () => {
  it("keeps the second card open when it replaces the first, which shows nothing of the first's", () => {
    const store = open();
    expect(screen.getByRole('dialog', { name: '@alice:x' })).toBeTruthy();
    act(() => store.set(userRoomProfileAtom, show('@bob:x')));
    expect(store.get(userRoomProfileAtom)?.userId).toBe('@bob:x');
    const card = screen.getByRole('dialog', { name: '@bob:x' });
    expect(card.textContent).toBe('@bob:x');
  });

  it('closes on Escape and on a click outside', () => {
    const store = open();
    fireEvent.keyDown(screen.getByText('@alice:x'), { key: 'Escape' });
    expect(store.get(userRoomProfileAtom)).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => store.set(userRoomProfileAtom, show('@alice:x')));
    fireEvent.mouseDown(screen.getByText('Outside'));
    expect(store.get(userRoomProfileAtom)).toBeUndefined();
  });
});
