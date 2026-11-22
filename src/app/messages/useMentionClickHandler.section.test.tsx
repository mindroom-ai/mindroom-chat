// @vitest-environment jsdom

// A room link clicked in a message, with the app's own navigation: which section the join page of
// a room that is not joined opens in. useMentionClickHandler.test.tsx covers the handler alone.

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { mDirectAtom } from '../matrix/state/mDirectList';
import { roomToParentsAtom } from '../matrix/state/roomToParents';
import { DIRECT_ROOM_PATH, HOME_ROOM_PATH, SPACE_ROOM_PATH } from '../routes/paths';
import { useMentionClickHandler } from './useMentionClickHandler';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../navigation/useUserRoomProfileState', () => ({
  useOpenUserRoomProfile: () => vi.fn(),
}));

const SPACE_ID = '!ops-space:example.org';
const SOURCE_ROOM_ID = '!harbor-desk:example.org';
const CHILD_ROOM_ID = '!field-notes:remote.example.org';
const INVITED_ROOM_ID = '!invited-desk:remote.example.org';
// A space the account left, which the client still holds, and a space below it the account is
// invited to.
const LEFT_PARENT_ID = '!old-fleet:remote.example.org';
const INVITED_SUBSPACE_ID = '!dock-crew:remote.example.org';

const makeRoom = (
  roomId: string,
  { membership = KnownMembership.Join as string, alias = null as string | null, isSpace = false }
): Room =>
  ({
    roomId,
    getMyMembership: () => membership,
    getCanonicalAlias: () => alias,
    getAltAliases: () => [],
    isSpaceRoom: () => isSpace,
  } as unknown as Room);

const rooms = [
  makeRoom(SPACE_ID, { isSpace: true }),
  makeRoom(SOURCE_ROOM_ID, {}),
  // An invite whose canonical alias no longer leads to the room.
  makeRoom(INVITED_ROOM_ID, {
    membership: KnownMembership.Invite,
    alias: '#renamed-desk:remote.example.org',
  }),
  makeRoom(LEFT_PARENT_ID, { membership: KnownMembership.Leave, isSpace: true }),
  makeRoom(INVITED_SUBSPACE_ID, { membership: KnownMembership.Invite, isSpace: true }),
];
const client = {
  getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId) ?? null,
  getRooms: () => rooms,
} as unknown as MatrixClient;

function Message({ mentionId, via }: { mentionId: string; via?: string }) {
  const onClick = useMentionClickHandler(SOURCE_ROOM_ID);
  return (
    <a href="#placeholder" data-mention-id={mentionId} data-mention-via={via} onClick={onClick}>
      mention
    </a>
  );
}

describe('a room link clicked in a message, for a room that is not joined', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** Clicks the link on the page at `from` and gives the address the app went to. */
  const clickFrom = (from: string, mention: { mentionId: string; via?: string }): string => {
    const store = createStore();
    // The space lists the source room, the child room and the invited room as its rooms.
    store.set(roomToParentsAtom, {
      type: 'INITIALIZE',
      roomToParents: new Map([
        ...[SOURCE_ROOM_ID, CHILD_ROOM_ID, INVITED_ROOM_ID].map(
          (roomId) => [roomId, new Set([SPACE_ID])] as const
        ),
        [INVITED_SUBSPACE_ID, new Set([LEFT_PARENT_ID])],
      ]),
      chatRooms: new Set<string>(),
    });
    store.set(mDirectAtom, { type: 'INITIALIZE', rooms: new Set<string>() });
    let address = '';
    const Probe = () => {
      const { pathname, search } = useLocation();
      address = `${pathname}${search}`;
      return null;
    };
    const page = <Message {...mention} />;
    act(() => {
      root.render(
        <JotaiProvider store={store}>
          <MatrixClientProvider value={client}>
            <MemoryRouter initialEntries={[from]}>
              <Probe />
              <Routes>
                <Route path={HOME_ROOM_PATH} element={page} />
                <Route path={DIRECT_ROOM_PATH} element={page} />
                <Route path={SPACE_ROOM_PATH} element={page} />
              </Routes>
            </MemoryRouter>
          </MatrixClientProvider>
        </JotaiProvider>
      );
    });
    const link = container.querySelector('a');
    if (!link) throw new Error('Expected the mention link');
    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    return address;
  };

  it("stays beside the selected space's rooms for a room of that space", () => {
    expect(
      clickFrom('/!ops-space%3Aexample.org/!harbor-desk%3Aexample.org', {
        mentionId: CHILD_ROOM_ID,
        via: 'remote.example.org',
      })
    ).toBe(
      '/!ops-space%3Aexample.org/!field-notes%3Aremote.example.org?viaServers=remote.example.org'
    );
  });

  it("opens a room of a space in that space from the source room's Home address", () => {
    expect(
      clickFrom('/home/!harbor-desk%3Aexample.org', {
        mentionId: CHILD_ROOM_ID,
        via: 'remote.example.org',
      })
    ).toBe(
      '/!ops-space%3Aexample.org/!field-notes%3Aremote.example.org?viaServers=remote.example.org'
    );
  });

  it('opens a room no space lists on Home, by the alias the link names', () => {
    expect(
      clickFrom('/!ops-space%3Aexample.org/!harbor-desk%3Aexample.org', {
        mentionId: '#elsewhere:remote.example.org',
      })
    ).toBe('/home/%23elsewhere%3Aremote.example.org');
  });

  it.each([
    ['Home', '/home/!harbor-desk%3Aexample.org'],
    ['a space', '/!ops-space%3Aexample.org/!harbor-desk%3Aexample.org'],
  ])(
    'opens an invited space on its own space route from %s, not below a space the account left',
    (_section, from) => {
      expect(clickFrom(from, { mentionId: INVITED_SUBSPACE_ID, via: 'remote.example.org' })).toBe(
        '/!dock-crew%3Aremote.example.org?viaServers=remote.example.org'
      );
    }
  );

  it('names an invited room by its room ID, not by an alias that may be stale', () => {
    expect(
      clickFrom('/!ops-space%3Aexample.org/!harbor-desk%3Aexample.org', {
        mentionId: INVITED_ROOM_ID,
      })
    ).toBe('/!ops-space%3Aexample.org/!invited-desk%3Aremote.example.org');
  });
});
