// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JoinRule, type MatrixClient, type Room } from 'matrix-js-sdk';
import type { IHierarchyRoom } from 'matrix-js-sdk/lib/@types/spaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../../matrix/hooks/useMatrixClient';
import { ScreenSize, ScreenSizeProvider } from '../../../lib/hooks/useScreenSize';
import type { HierarchyItem } from '../../useSpaceHierarchy';
import { RoomItemCard } from '../RoomItem';
import { SpaceItemCard } from '../SpaceItem';

// A click on a lobby card of a room or space the person is not in does what the card's button
// does: join, accept the invite, or ask to join. Phones and wider screens alike.

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../../avatars/RoomAvatar', () => ({
  RoomAvatar: ({ renderFallback }: { renderFallback: () => React.ReactNode }) => renderFallback(),
  RoomIcon: () => React.createElement('i'),
}));

vi.mock('../../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../matrix/room', async () => {
  const actual = await vi.importActual<typeof import('../../../matrix/room')>(
    '../../../matrix/room'
  );
  return { ...actual, getRoomAvatarUrl: () => undefined };
});

const ROOM_ID = '!harbor:example.org';
const SPACE_ID = '!guild:example.org';
const VIA = ['one.example.org'];

const hierarchyItem = (roomId: string, space = false): HierarchyItem =>
  ({
    roomId,
    parentId: '!field:example.org',
    content: { via: VIA },
    ts: 1,
    space,
  } as HierarchyItem);

const summaryOf = (roomId: string, name: string, joinRule: string): IHierarchyRoom =>
  ({
    room_id: roomId,
    name,
    topic: 'Weekly notes and decisions about the next release',
    world_readable: false,
    guest_can_join: false,
    num_joined_members: 4,
    join_rule: joinRule,
    children_state: [],
  } as unknown as IHierarchyRoom);

const client = () =>
  ({
    getRoom: vi.fn(() => null),
    getRooms: vi.fn(() => []),
    getUserId: vi.fn(() => '@viewer:example.org'),
    getSafeUserId: vi.fn(() => '@viewer:example.org'),
    joinRoom: vi.fn(() => new Promise(() => undefined)),
    knockRoom: vi.fn(() => new Promise(() => undefined)),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as MatrixClient);

/** A room the client knows, with the user's membership in it. */
const knownRoom = (membership: string, joinRule: JoinRule): Room =>
  ({
    roomId: ROOM_ID,
    name: 'Harbor Plans',
    getMyMembership: () => membership,
    getJoinRule: () => joinRule,
  } as unknown as Room);

let mx: MatrixClient;

beforeEach(() => {
  mx = client();
});

afterEach(cleanup);

const renderRoomCard = (
  joinRule: string,
  {
    screenSize = ScreenSize.Desktop,
    local,
    onOpen = vi.fn(),
  }: { screenSize?: ScreenSize; local?: Room; onOpen?: (roomId: string) => void } = {}
) => {
  render(
    <ScreenSizeProvider value={screenSize}>
      <MatrixClientProvider value={mx}>
        <RoomItemCard
          item={hierarchyItem(ROOM_ID)}
          loading={false}
          summary={summaryOf(ROOM_ID, 'Harbor Plans', joinRule)}
          onOpen={onOpen}
          getRoom={() => local}
        />
      </MatrixClientProvider>
    </ScreenSizeProvider>
  );
  return onOpen;
};

const topic = () => screen.getByText('Weekly notes and decisions about the next release');

describe('a lobby room card of a room the person is not in', () => {
  it.each([ScreenSize.Desktop, ScreenSize.Mobile])('joins on a click anywhere (%s)', (size) => {
    renderRoomCard(JoinRule.Public, { screenSize: size });
    fireEvent.click(topic());
    expect(mx.joinRoom).toHaveBeenCalledTimes(1);
    expect(mx.joinRoom).toHaveBeenCalledWith(ROOM_ID, { viaServers: VIA });
    fireEvent.click(screen.getByText('Harbor Plans'));
    // The join runs: a second click sends nothing more, as a second press of Join would.
    expect(mx.joinRoom).toHaveBeenCalledTimes(1);
  });

  it('joins a room the person left, through the card as through its button', () => {
    renderRoomCard(JoinRule.Restricted, { local: knownRoom('leave', JoinRule.Restricted) });
    fireEvent.click(topic());
    expect(mx.joinRoom).toHaveBeenCalledWith(ROOM_ID, { viaServers: VIA });
  });

  it('accepts an invite on a click anywhere', () => {
    renderRoomCard(JoinRule.Invite, { local: knownRoom('invite', JoinRule.Invite) });
    fireEvent.click(topic());
    expect(mx.joinRoom).toHaveBeenCalledWith(ROOM_ID, { viaServers: VIA });
  });

  it('opens the request to join for a room that takes requests', () => {
    renderRoomCard(JoinRule.Knock);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(topic());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mx.joinRoom).not.toHaveBeenCalled();
    // A click inside the request, which React passes on to the card, does not ask again.
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('does nothing for a room with no way in, which offers no button either', () => {
    renderRoomCard(JoinRule.Invite);
    expect(screen.getByText('Access unavailable')).toBeTruthy();
    fireEvent.click(topic());
    expect(mx.joinRoom).not.toHaveBeenCalled();
    expect(mx.knockRoom).not.toHaveBeenCalled();
  });

  it('does nothing for a room the person was banned from', () => {
    renderRoomCard(JoinRule.Public, { local: knownRoom('ban', JoinRule.Public) });
    fireEvent.click(topic());
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });
});

describe('a lobby room card of a joined room', () => {
  it('keeps opening by its Open Room button on wider screens', () => {
    const onOpen = renderRoomCard(JoinRule.Public, { local: knownRoom('join', JoinRule.Public) });
    fireEvent.click(topic());
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open Room' }));
    expect(onOpen).toHaveBeenCalledWith(ROOM_ID);
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });

  it('opens on a phone by a tap anywhere', () => {
    const onOpen = renderRoomCard(JoinRule.Public, {
      screenSize: ScreenSize.Mobile,
      local: knownRoom('join', JoinRule.Public),
    });
    fireEvent.click(topic());
    expect(onOpen).toHaveBeenCalledWith(ROOM_ID);
    expect(mx.joinRoom).not.toHaveBeenCalled();
  });
});

describe('a lobby heading of a space the person is not in', () => {
  it('joins on a click on its name, as its Join chip does', async () => {
    render(
      <MatrixClientProvider value={mx}>
        <SpaceItemCard
          item={hierarchyItem(SPACE_ID, true)}
          summary={summaryOf(SPACE_ID, 'Design Guild', JoinRule.Public)}
          joined={false}
          closed={false}
          canEditChild={false}
          getRoom={() => undefined}
        />
      </MatrixClientProvider>
    );
    await act(async () => undefined);
    fireEvent.click(screen.getByText('Design Guild'));
    expect(mx.joinRoom).toHaveBeenCalledWith(SPACE_ID, { viaServers: VIA });
  });
});
