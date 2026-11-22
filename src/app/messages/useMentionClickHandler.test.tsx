// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { SpaceProvider } from '../matrix/hooks/useSpace';
import {
  getHomeRoomPath,
  getSpacePath,
  getSpaceRoomPath,
  withSearchParam,
} from '../routes/pathUtils';
import { useMentionClickHandler } from './useMentionClickHandler';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  navigatePath: vi.fn(),
  navigateRoom: vi.fn(),
  navigateSpace: vi.fn(),
  openProfile: vi.fn(),
  // The path `useRoomNavigate` picks for a room: Home here, unless a test puts it in a space.
  roomPath: vi.fn<(roomId: string, eventId?: string) => string>(),
}));

vi.mock('../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigatePath: mocks.navigatePath,
    navigateRoom: mocks.navigateRoom,
    navigateSpace: mocks.navigateSpace,
    roomPath: mocks.roomPath,
  }),
}));

vi.mock('../navigation/useUserRoomProfileState', () => ({
  useOpenUserRoomProfile: () => mocks.openProfile,
}));

const CURRENT_ROOM_ID = '!harbor-desk:example.org';
const CURRENT_SPACE_ID = '!ops-space:example.org';

type MockRoomOptions = {
  roomId: string;
  membership?: string;
  canonicalAlias?: string | null;
  altAliases?: string[];
  isSpace?: boolean;
};

const makeRoom = ({
  roomId,
  membership = KnownMembership.Join,
  canonicalAlias = null,
  altAliases = [],
  isSpace = false,
}: MockRoomOptions): Room =>
  ({
    roomId,
    getMyMembership: () => membership,
    getCanonicalAlias: () => canonicalAlias,
    getAltAliases: () => altAliases,
    isSpaceRoom: () => isSpace,
  } as unknown as Room);

const makeClient = (rooms: Room[]): MatrixClient =>
  ({
    getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId) ?? null,
    getRooms: () => rooms,
  } as unknown as MatrixClient);

function MentionPill({
  mentionId,
  eventId,
  via,
}: {
  mentionId?: string;
  eventId?: string;
  via?: string;
}) {
  const onClick = useMentionClickHandler(CURRENT_ROOM_ID);
  return (
    <a
      href="#placeholder"
      data-mention-id={mentionId}
      data-mention-event-id={eventId}
      data-mention-via={via}
      onClick={onClick}
    >
      mention
    </a>
  );
}

describe('useMentionClickHandler', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.navigatePath.mockReset();
    mocks.navigateRoom.mockReset();
    mocks.navigateSpace.mockReset();
    mocks.openProfile.mockReset();
    mocks.roomPath.mockReset();
    mocks.roomPath.mockImplementation((roomId, eventId) => getHomeRoomPath(roomId, eventId));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderAndClick = (
    client: MatrixClient,
    props: { mentionId?: string; eventId?: string; via?: string },
    space: Room | null = null
  ) => {
    act(() => {
      root.render(
        <MatrixClientProvider value={client}>
          <SpaceProvider value={space}>
            <MentionPill {...props} />
          </SpaceProvider>
        </MatrixClientProvider>
      );
    });
    const link = container.querySelector('a');
    if (!link) throw new Error('Expected mention anchor element');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(event);
    });
    return { event, link };
  };

  it('opens the user profile and prevents default for a user mention', () => {
    const space = makeRoom({ roomId: CURRENT_SPACE_ID, isSpace: true });
    const client = makeClient([space]);
    const { event, link } = renderAndClick(client, { mentionId: '@casey:example.org' }, space);

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.openProfile).toHaveBeenCalledWith(
      CURRENT_ROOM_ID,
      CURRENT_SPACE_ID,
      '@casey:example.org',
      link.getBoundingClientRect()
    );
    expect(mocks.navigateRoom).not.toHaveBeenCalled();
    expect(mocks.navigateSpace).not.toHaveBeenCalled();
    expect(mocks.navigatePath).not.toHaveBeenCalled();
  });

  it('navigates directly to a joined room by ID, canonical alias, or alt alias', () => {
    const room = makeRoom({
      roomId: '!dockyard:example.org',
      canonicalAlias: '#dockyard:example.org',
      altAliases: ['#north-pier:example.org'],
    });
    const client = makeClient([room]);

    for (const [mentionId, eventId] of [
      ['!dockyard:example.org', undefined],
      ['#dockyard:example.org', '$entry-1'],
      ['#north-pier:example.org', undefined],
    ] as const) {
      mocks.navigateRoom.mockReset();
      const { event } = renderAndClick(client, { mentionId, eventId });
      expect(event.defaultPrevented).toBe(true);
      expect(mocks.navigateRoom).toHaveBeenCalledWith('!dockyard:example.org', eventId);
      expect(mocks.navigatePath).not.toHaveBeenCalled();
      expect(mocks.navigateSpace).not.toHaveBeenCalled();
    }
  });

  it('ignores data-mention-via and calls navigateRoom for a joined room', () => {
    const room = makeRoom({
      roomId: '!dockyard:example.org',
      canonicalAlias: '#dockyard:example.org',
    });
    const client = makeClient([room]);

    const { event } = renderAndClick(client, {
      mentionId: '!dockyard:example.org',
      eventId: '$entry-2',
      via: 'example.org,relay.example.org',
    });

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.navigateRoom).toHaveBeenCalledWith('!dockyard:example.org', '$entry-2');
    expect(mocks.navigatePath).not.toHaveBeenCalled();
    expect(mocks.navigateSpace).not.toHaveBeenCalled();
  });

  it('opens a joined space on its lobby without an event, or via navigateRoom with an event', () => {
    const space = makeRoom({
      roomId: '!harbor-space:example.org',
      canonicalAlias: '#harbor-space:example.org',
      isSpace: true,
    });
    const client = makeClient([space]);

    const lobbyClick = renderAndClick(client, { mentionId: '#harbor-space:example.org' });
    expect(lobbyClick.event.defaultPrevented).toBe(true);
    expect(mocks.navigateSpace).toHaveBeenCalledWith('!harbor-space:example.org');
    expect(mocks.navigateRoom).not.toHaveBeenCalled();

    mocks.navigateSpace.mockReset();
    const eventClick = renderAndClick(client, {
      mentionId: '!harbor-space:example.org',
      eventId: '$notice-42',
    });
    expect(eventClick.event.defaultPrevented).toBe(true);
    expect(mocks.navigateRoom).toHaveBeenCalledWith('!harbor-space:example.org', '$notice-42');
    expect(mocks.navigateSpace).not.toHaveBeenCalled();
  });

  it('navigates to the route roomPath gives for an unjoined room alias, preserving eventId and viaServers', () => {
    const client = makeClient([]);
    const alias = '#field-notes:remote.example.org';

    const aliasOnly = renderAndClick(client, { mentionId: alias });
    expect(aliasOnly.event.defaultPrevented).toBe(true);
    expect(mocks.navigatePath).toHaveBeenCalledWith(getHomeRoomPath(alias));
    expect(mocks.navigateRoom).not.toHaveBeenCalled();

    mocks.navigatePath.mockReset();
    const withEventAndVia = renderAndClick(client, {
      mentionId: alias,
      eventId: '$note-7',
      via: 'remote.example.org,relay.example.org',
    });
    expect(withEventAndVia.event.defaultPrevented).toBe(true);
    expect(mocks.navigatePath).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(alias, '$note-7'), {
        viaServers: 'remote.example.org,relay.example.org',
      })
    );
  });

  it('navigates to the route roomPath gives for an unjoined room ID and preserves viaServers and eventId', () => {
    const client = makeClient([]);
    const roomId = '!field-notes:remote.example.org';

    const roomOnly = renderAndClick(client, {
      mentionId: roomId,
      via: 'remote.example.org',
    });
    expect(roomOnly.event.defaultPrevented).toBe(true);
    expect(mocks.navigatePath).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId), {
        viaServers: 'remote.example.org',
      })
    );

    mocks.navigatePath.mockReset();
    const withEvent = renderAndClick(client, {
      mentionId: roomId,
      eventId: '$entry-9',
      via: 'remote.example.org,backup.example.org',
    });
    expect(withEvent.event.defaultPrevented).toBe(true);
    expect(mocks.navigatePath).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath(roomId, '$entry-9'), {
        viaServers: 'remote.example.org,backup.example.org',
      })
    );
  });

  it('keeps an unjoined room in the section roomPath picks, such as the selected space', () => {
    const client = makeClient([]);
    const roomId = '!field-notes:remote.example.org';
    mocks.roomPath.mockImplementation((room, eventId) =>
      getSpaceRoomPath(CURRENT_SPACE_ID, room, eventId)
    );

    const { event } = renderAndClick(client, {
      mentionId: roomId,
      eventId: '$entry-9',
      via: 'remote.example.org',
    });

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.roomPath).toHaveBeenCalledWith(roomId, '$entry-9');
    expect(mocks.navigatePath).toHaveBeenCalledWith(
      '/!ops-space%3Aexample.org/!field-notes%3Aremote.example.org/%24entry-9?viaServers=remote.example.org'
    );
    expect(mocks.navigateRoom).not.toHaveBeenCalled();
  });

  it('opens a known space that is not joined on its own space route, or by roomPath with an event', () => {
    const invitedSpace = makeRoom({
      roomId: '!dock-crew:remote.example.org',
      canonicalAlias: '#dock-crew:remote.example.org',
      membership: KnownMembership.Invite,
      isSpace: true,
    });
    const client = makeClient([invitedSpace]);
    // Where roomPath would put it: below a space above it.
    mocks.roomPath.mockImplementation((room, eventId) =>
      getSpaceRoomPath('!old-fleet:remote.example.org', room, eventId)
    );

    const spaceClick = renderAndClick(client, {
      mentionId: '#dock-crew:remote.example.org',
      via: 'remote.example.org',
    });
    expect(spaceClick.event.defaultPrevented).toBe(true);
    expect(mocks.navigatePath).toHaveBeenCalledWith(
      withSearchParam(getSpacePath('!dock-crew:remote.example.org'), {
        viaServers: 'remote.example.org',
      })
    );
    expect(mocks.roomPath).not.toHaveBeenCalled();
    expect(mocks.navigateSpace).not.toHaveBeenCalled();

    mocks.navigatePath.mockReset();
    const eventClick = renderAndClick(client, {
      mentionId: '!dock-crew:remote.example.org',
      eventId: '$notice-3',
    });
    expect(eventClick.event.defaultPrevented).toBe(true);
    expect(mocks.roomPath).toHaveBeenCalledWith('!dock-crew:remote.example.org', '$notice-3');
    expect(mocks.navigatePath).toHaveBeenCalledWith(
      getSpaceRoomPath(
        '!old-fleet:remote.example.org',
        '!dock-crew:remote.example.org',
        '$notice-3'
      )
    );
  });

  it('routes known non-joined rooms (invite or leave) through navigatePath using knownRoom.roomId and preserving viaServers', () => {
    const invitedRoom = makeRoom({
      roomId: '!invited-desk:remote.example.org',
      canonicalAlias: '#invited-desk:remote.example.org',
      membership: KnownMembership.Invite,
    });
    const staleAltInvitedRoom = makeRoom({
      roomId: '!stale-invite:example.org',
      canonicalAlias: null,
      altAliases: ['#stale-alt:example.org'],
      membership: KnownMembership.Invite,
    });
    const leftRoom = makeRoom({
      roomId: '!left-desk:remote.example.org',
      canonicalAlias: '#left-desk:remote.example.org',
      membership: KnownMembership.Leave,
    });
    const client = makeClient([invitedRoom, staleAltInvitedRoom, leftRoom]);

    const inviteClick = renderAndClick(client, {
      mentionId: '#invited-desk:remote.example.org',
      via: 'remote.example.org',
    });
    expect(inviteClick.event.defaultPrevented).toBe(true);
    expect(mocks.navigatePath).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath('!invited-desk:remote.example.org'), {
        viaServers: 'remote.example.org',
      })
    );
    expect(mocks.navigateRoom).not.toHaveBeenCalled();

    mocks.navigatePath.mockReset();
    const staleAltClick = renderAndClick(client, {
      mentionId: '#stale-alt:example.org',
      eventId: '$invite-note',
      via: 'example.org',
    });
    expect(staleAltClick.event.defaultPrevented).toBe(true);
    expect(mocks.navigatePath).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath('!stale-invite:example.org', '$invite-note'), {
        viaServers: 'example.org',
      })
    );
    expect(mocks.navigateRoom).not.toHaveBeenCalled();

    mocks.navigatePath.mockReset();
    const leftClick = renderAndClick(client, {
      mentionId: '!left-desk:remote.example.org',
      eventId: '$old-1',
      via: 'remote.example.org,mirror.example.org',
    });
    expect(leftClick.event.defaultPrevented).toBe(true);
    expect(mocks.navigatePath).toHaveBeenCalledWith(
      withSearchParam(getHomeRoomPath('!left-desk:remote.example.org', '$old-1'), {
        viaServers: 'remote.example.org,mirror.example.org',
      })
    );
    expect(mocks.navigateRoom).not.toHaveBeenCalled();
  });

  it('does not prevent default or navigate when data-mention-id is missing or malformed', () => {
    const client = makeClient([]);

    for (const mentionId of [
      undefined,
      '',
      'not-a-matrix-id',
      'https://example.org',
      '$event:example.org',
    ]) {
      const { event } = renderAndClick(client, { mentionId });
      expect(event.defaultPrevented).toBe(false);
    }

    expect(mocks.openProfile).not.toHaveBeenCalled();
    expect(mocks.navigateRoom).not.toHaveBeenCalled();
    expect(mocks.navigateSpace).not.toHaveBeenCalled();
    expect(mocks.navigatePath).not.toHaveBeenCalled();
  });
});
