// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JoinRule, MatrixError, type MatrixClient } from 'matrix-js-sdk';
import { MatrixClientProvider } from '../../hooks/useMatrixClient';
import { JoinRoomRow } from './JoinRoomRow';

const ROOM_ID = '!lounge:example.org';

/** A client that knows no rooms; `joinRoom` settles when the test says so. */
const fakeClient = () => {
  let settle: { resolve: () => void; reject: (error: unknown) => void } | undefined;
  const joinRoom = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      })
  );
  const client = {
    getRoom: () => null,
    getUserId: () => '@me:example.org',
    on: vi.fn(),
    removeListener: vi.fn(),
    joinRoom,
  } as unknown as MatrixClient;
  return {
    client,
    joinRoom,
    resolve: () => settle?.resolve(),
    reject: (error: unknown) => settle?.reject(error),
  };
};

const renderRow = (
  client: MatrixClient,
  props: Partial<React.ComponentProps<typeof JoinRoomRow>> = {}
) => {
  const onOpen = vi.fn();
  render(
    <MatrixClientProvider value={client}>
      <ul>
        <JoinRoomRow
          roomIdOrAlias={ROOM_ID}
          roomId={ROOM_ID}
          name="Lounge"
          topic="Coffee and chat"
          memberCount={12}
          joinRule={JoinRule.Public}
          allRooms={[]}
          onOpen={onOpen}
          {...props}
        />
      </ul>
    </MatrixClientProvider>
  );
  return onOpen;
};

afterEach(cleanup);

describe('JoinRoomRow', () => {
  it('shows the name, member count and topic, and opens a joined room', () => {
    const { client } = fakeClient();
    const onOpen = renderRow(client, { allRooms: [ROOM_ID] });

    expect(screen.getByText('Lounge')).toBeTruthy();
    expect(screen.getByText('12 Members · Coffee and chat')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith(ROOM_ID);
  });

  it('joins, shows Joining while the server answers, then Open', async () => {
    const { client, joinRoom, resolve } = fakeClient();
    const onOpen = renderRow(client);

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(joinRoom).toHaveBeenCalledWith(ROOM_ID, { viaServers: undefined });
    const joining = screen.getByRole('button', { name: 'Joining' });
    expect(joining.getAttribute('aria-disabled')).toBe('true');
    // A second press while the join runs sends nothing more.
    fireEvent.click(joining);
    expect(joinRoom).toHaveBeenCalledTimes(1);

    await act(async () => resolve());
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith(ROOM_ID);
  });

  it('shows why a join failed on the row and offers Join again', async () => {
    const { client, reject } = fakeClient();
    renderRow(client);

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await act(async () =>
      reject(new MatrixError({ errcode: 'M_FORBIDDEN', error: 'You are not invited' }, 403))
    );
    expect(screen.getByRole('alert').textContent).toContain('You are not invited');
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
  });

  it('waits for the room details before offering Join', () => {
    const { client } = fakeClient();
    renderRow(client, { joinRule: undefined });
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });

  it('opens the room, or its preview, from the name', () => {
    const { client, joinRoom } = fakeClient();
    const onOpen = renderRow(client);
    fireEvent.click(screen.getByText('Lounge'));
    expect(onOpen).toHaveBeenCalledWith(ROOM_ID);
    expect(joinRoom).not.toHaveBeenCalled();
  });
});
