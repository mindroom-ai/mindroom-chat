// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type FocusTrap from 'focus-trap-react';
import { getDefaultStore, Provider as StoreProvider } from 'jotai';
import {
  createClient,
  KnownMembership,
  MatrixEvent,
  Room,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import {
  BrowserRouter,
  HashRouter,
  MemoryRouter,
  RouterProvider,
  createBrowserRouter,
  createHashRouter,
  useLocation,
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../app/matrix/hooks/useMatrixClient';
import { useBindMDirectAtom } from '../app/matrix/state/mDirectList';
import { roomToParentsAtom, useBindRoomToParentsAtom } from '../app/matrix/state/roomToParents';
import { UserRoomProfileRenderer } from '../app/members/profile/UserRoomProfileRenderer';
import {
  getParentRooms,
  offersSubRooms,
  UserProfileCard,
  useOpenUserProfile,
  useParentRooms,
  useRoomHref,
  useRoomNavigate,
  type RoomNavigate,
} from './room';

// jsdom lays nothing out, so every element counts as shown for the floating card's focus trap.
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

const ROOM = '!lobby:example.org';
const THREAD = '$root:example.org';
const REPLY = '$reply:example.org';
// A client that knows no room by an alias, so paths name rooms by their ID.
const client = { getRoom: () => null } as unknown as MatrixClient;

afterEach(cleanup);

/** Renders `ui` signed in to `client`. */
const renderSignedIn = (ui: ReactNode) =>
  render(<MatrixClientProvider value={client}>{ui}</MatrixClientProvider>);

describe('useRoomHref', () => {
  function Links() {
    return (
      <>
        <a href={useRoomHref(ROOM)}>Room</a>
        <a href={useRoomHref(ROOM, THREAD)}>Thread</a>
      </>
    );
  }
  const hrefs = (createRouter: typeof createBrowserRouter, basename: string) => {
    const router = createRouter([{ path: '*', element: <Links /> }], { basename });
    renderSignedIn(<RouterProvider router={router} />);
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    const found = [href('Room'), href('Thread')];
    cleanup();
    router.dispose();
    return found;
  };

  it("links to a room and to its thread under the browser router's base path", () => {
    window.history.replaceState(null, '', '/chat/p/example/');
    expect(hrefs(createBrowserRouter, '/chat')).toEqual([
      '/chat/home/!lobby%3Aexample.org',
      '/chat/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org',
    ]);
  });

  it('puts the paths after the hash with the hash router', () => {
    window.history.replaceState(null, '', '/#/p/example/');
    expect(hrefs(createHashRouter, '/')).toEqual([
      '#/home/!lobby%3Aexample.org',
      '#/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org',
    ]);
  });
});

describe('useRoomNavigate', () => {
  /** A room picker that tells its callbacks more than the room: an index, a name, or the click. */
  function Picker({
    onPick,
    onPickThread,
  }: {
    onPick: (roomId: string, how: number | string | MouseEvent) => void;
    onPickThread: (roomId: string, threadId: string, index: number) => void;
  }) {
    return (
      <>
        <button type="button" onClick={() => onPick(ROOM, 1)}>
          Pick the second
        </button>
        <button type="button" onClick={() => onPick(ROOM, 'clicked')}>
          Pick by name
        </button>
        <button type="button" onClick={(event) => onPick(ROOM, event)}>
          Pick by click
        </button>
        <button type="button" onClick={() => onPickThread(ROOM, THREAD, 2)}>
          Pick the thread
        </button>
      </>
    );
  }
  function Buttons() {
    const { navigateRoom, navigateRoomThread } = useRoomNavigate();
    /** A plugin's own wrapper, typed by the SDK's parameters, so the options may be left out. */
    const openRoom = (...args: Parameters<RoomNavigate['navigateRoom']>) => navigateRoom(...args);
    return (
      <>
        <button type="button" onClick={() => openRoom(ROOM)}>
          Room
        </button>
        <button type="button" onClick={() => navigateRoomThread(ROOM, THREAD)}>
          Thread
        </button>
        <button type="button" onClick={() => navigateRoom(ROOM, { eventId: THREAD })}>
          Room at the root
        </button>
        <button type="button" onClick={() => navigateRoomThread(ROOM, THREAD, { eventId: REPLY })}>
          Thread at the reply
        </button>
        <button type="button" onClick={() => navigateRoom(ROOM, { replace: true })}>
          Room in place
        </button>
        <button type="button" onClick={() => navigateRoomThread(ROOM, THREAD, { replace: true })}>
          Thread in place
        </button>
        <Picker onPick={navigateRoom} onPickThread={navigateRoomThread} />
      </>
    );
  }
  function Address() {
    const { pathname, search } = useLocation();
    return <output>{`${pathname}${search}`}</output>;
  }
  const renderButtons = () =>
    renderSignedIn(
      <MemoryRouter initialEntries={['/p/example/']}>
        <Buttons />
        <Address />
      </MemoryRouter>
    );
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
  const address = () => screen.getByRole('status').textContent;

  it('opens a room, and a thread in it', () => {
    renderButtons();
    click('Room');
    expect(address()).toBe('/home/!lobby%3Aexample.org');
    click('Thread');
    expect(address()).toBe('/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org');
  });

  it("opens the room at an event and the thread at a reply, at the app's own addresses", () => {
    renderButtons();
    click('Room at the root');
    expect(address()).toBe('/home/!lobby%3Aexample.org/%24root%3Aexample.org');
    click('Thread at the reply');
    expect(address()).toBe(
      '/home/!lobby%3Aexample.org/%24reply%3Aexample.org?threadId=%24root%3Aexample.org'
    );
  });

  it('opens the room or the thread itself, as a new page, as a callback that gets more arguments', () => {
    window.history.replaceState(null, '', '/p/example/');
    renderSignedIn(
      <BrowserRouter>
        <Buttons />
        <Address />
      </BrowserRouter>
    );
    for (const [from, pick, opened] of [
      ['Thread', 'Pick the second', '/home/!lobby%3Aexample.org'],
      ['Thread', 'Pick by name', '/home/!lobby%3Aexample.org'],
      ['Thread', 'Pick by click', '/home/!lobby%3Aexample.org'],
      ['Room', 'Pick the thread', '/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org'],
    ] as const) {
      click(from);
      const entries = window.history.length;
      click(pick);
      expect(address()).toBe(opened);
      expect(window.history.length).toBe(entries + 1);
    }
  });

  for (const [name, Router, start] of [
    ['browser', BrowserRouter, '/p/example/'],
    ['hash', HashRouter, '/#/p/example/'],
  ] as const) {
    it(`replaces the page it leaves with the ${name} router, and adds one without replace`, () => {
      window.history.replaceState(null, '', start);
      renderSignedIn(
        <Router>
          <Buttons />
          <Address />
        </Router>
      );
      const entries = window.history.length;
      click('Room in place');
      expect(address()).toBe('/home/!lobby%3Aexample.org');
      click('Thread in place');
      expect(address()).toBe('/home/!lobby%3Aexample.org?threadId=%24root%3Aexample.org');
      expect(window.history.length).toBe(entries);
      click('Room');
      expect(window.history.length).toBe(entries + 1);
    });
  }
});

describe('useOpenUserProfile and UserProfileCard', () => {
  const ME = '@ada:example.org';
  const BOB = '@bob:example.org';
  const CAROL = '@carol:example.org';
  // The rectangle of what a plugin's user clicked, as `getBoundingClientRect()` gives it.
  const ANCHOR = { x: 100, y: 200, width: 50, height: 20 };

  beforeEach(() => {
    // The card asks the homeserver for the person's profile; the stub keeps that off the network.
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
    // jsdom lays nothing out; the card places itself in a window of 1024 by 768.
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A client signed in as Ada, who moderates the room she shares with Bob and Carol. */
  const signedIn = () => {
    const account = createClient({ baseUrl: 'https://example.org', userId: ME });
    const room = new Room(ROOM, account, ME);
    room.currentState.setStateEvents([
      ...[
        [ME, 'Ada'],
        [BOB, 'Bob Builder'],
        [CAROL, 'Carol'],
      ].map(
        ([member, displayname]) =>
          new MatrixEvent({
            type: 'm.room.member',
            room_id: ROOM,
            sender: member,
            state_key: member,
            content: { membership: KnownMembership.Join, displayname },
          })
      ),
      new MatrixEvent({
        type: 'm.room.power_levels',
        room_id: ROOM,
        sender: ME,
        state_key: '',
        content: { users: { [ME]: 100 } },
      }),
    ]);
    account.store.storeRoom(room);
    return { account, room };
  };

  /** A plugin's buttons that open Bob's card in the room `roomId`, below or on the left. */
  function BobButtons({ roomId }: { roomId: string }) {
    const openUserProfile = useOpenUserProfile();
    return (
      <>
        <button type="button" onClick={() => openUserProfile(roomId, BOB, ANCHOR)}>
          Bob
        </button>
        <button type="button" onClick={() => openUserProfile(roomId, BOB, ANCHOR, 'Left')}>
          Bob on the left
        </button>
      </>
    );
  }

  /** `ui` in the app, signed in to `account`, with the app's floating profile card. */
  const inApp = (account: MatrixClient, ui: ReactNode) => (
    <StoreProvider>
      <MatrixClientProvider value={account}>
        <MemoryRouter>
          {ui}
          <UserRoomProfileRenderer />
        </MemoryRouter>
      </MatrixClientProvider>
    </StoreProvider>
  );
  const renderInApp = (account: MatrixClient, ui: ReactNode) => render(inApp(account, ui));

  it("opens the app's floating card of the person in the room at the anchor, which Escape closes", () => {
    const { account } = signedIn();
    renderInApp(account, <BobButtons roomId={ROOM} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bob' }));
    const card = screen.getByRole('dialog', { name: BOB });
    expect(card.querySelector('h2')?.textContent).toBe('Bob Builder');
    expect(card.textContent).toContain(BOB);
    // Under the anchor, lined up with its start, as a mention pill's card opens.
    expect(card.parentElement?.style.top).toBe('228px');
    expect(card.parentElement?.style.left).toBe('100px');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    // On the side it is given: its end 8 pixels before the anchor's start.
    fireEvent.click(screen.getByRole('button', { name: 'Bob on the left' }));
    expect(screen.getByRole('dialog', { name: BOB }).parentElement?.style.right).toBe('932px');
  });

  it('opens nothing for a room the client does not have, also once the room arrives', () => {
    const { account } = signedIn();
    const LATER = '!later:example.org';
    const ui = <BobButtons roomId={LATER} />;
    const view = renderInApp(account, ui);
    fireEvent.click(screen.getByRole('button', { name: 'Bob' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // Sync brings the room, and the app renders again: the click long past opens nothing then.
    account.store.storeRoom(new Room(LATER, account, ME));
    view.rerender(inApp(account, ui));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("shows the person's card inline, without the floating frame", () => {
    const { account, room } = signedIn();
    renderInApp(account, <UserProfileCard room={room} userId={ME} onDone={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeTruthy();
    expect(screen.getByText(ME)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts afresh for another person, so a ban begun for one never goes to the next', () => {
    const { account, room } = signedIn();
    const card = (userId: string) => (
      <UserProfileCard room={room} userId={userId} onDone={() => undefined} />
    );
    const view = renderInApp(account, card(BOB));
    fireEvent.click(screen.getByRole('button', { name: 'Ban' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason (Optional)' }), {
      target: { value: 'Spam' },
    });

    view.rerender(inApp(account, card(CAROL)));
    expect(screen.getByRole('heading', { name: 'Carol' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Reason (Optional)' })).toBeNull();
  });
});

describe('useParentRooms, getParentRooms and offersSubRooms', () => {
  const ME = '@ada:example.org';
  const GARDEN = '!garden:example.org';
  const ESTATE = '!estate:example.org';
  const IDEAS = '!ideas:example.org';
  const WITH_BOB = '!with-bob:example.org';
  const VIA = { via: ['example.org'] };

  const stateEvent = (roomId: string, type: string, stateKey: string, content: object) =>
    new MatrixEvent({
      type,
      state_key: stateKey,
      sender: ME,
      room_id: roomId,
      event_id: `$${roomId}-${type}-${stateKey}-${JSON.stringify(content)}`,
      content,
    });

  /**
   * Ada's client, in which the chat room Garden and the space Estate both list Ideas, which names
   * Garden as its parent, and her direct chat with Bob; the rooms' events reach the client as
   * sync's do.
   */
  const signedIn = () => {
    const account = createClient({ baseUrl: 'https://example.org', userId: ME });
    const joined = (roomId: string, state: MatrixEvent[]) => {
      const room = new Room(roomId, account, ME);
      room.currentState.setStateEvents(state);
      room.updateMyMembership(KnownMembership.Join);
      account.reEmitter.reEmit(room, [RoomStateEvent.Events, RoomEvent.MyMembership]);
      account.store.storeRoom(room);
      return room;
    };
    const garden = joined(GARDEN, [stateEvent(GARDEN, 'm.space.child', IDEAS, VIA)]);
    const estate = joined(ESTATE, [
      stateEvent(ESTATE, 'm.room.create', '', { type: 'm.space' }),
      stateEvent(ESTATE, 'm.space.child', IDEAS, VIA),
    ]);
    const ideas = joined(IDEAS, [
      stateEvent(IDEAS, 'm.space.parent', GARDEN, { canonical: true, ...VIA }),
    ]);
    const withBob = joined(WITH_BOB, []);
    account.store.storeAccountDataEvents([
      new MatrixEvent({ type: 'm.direct', content: { '@bob:example.org': [WITH_BOB] } }),
    ]);
    return { account, garden, estate, ideas, withBob };
  };

  /** The app's own map of parents and list of direct chats for `account`, as the app keeps them. */
  function AppState({ account }: { account: MatrixClient }) {
    useBindRoomToParentsAtom(account);
    useBindMDirectAtom(account);
    return null;
  }
  /** A plugin's list of the rooms `room` is a sub-room of. */
  function Parents({ room }: { room: Room }) {
    return (
      <output>
        {useParentRooms(room)
          .map(({ roomId }) => roomId)
          .join(' ')}
      </output>
    );
  }
  const renderParents = (account: MatrixClient, room: Room) =>
    render(
      <>
        <AppState account={account} />
        <Parents room={room} />
      </>
    );
  const shown = () => screen.getByRole('status').textContent;
  const readOnce = (room: Room) => getParentRooms(room).map(({ roomId }) => roomId);

  it('lists the chat room a room is a sub-room of, not the space that lists it too', () => {
    const { account, ideas } = signedIn();
    renderParents(account, ideas);
    expect(shown()).toBe(GARDEN);
    expect(readOnce(ideas)).toEqual([GARDEN]);
  });

  it('leaves out a parent the client does not have', () => {
    const { account, ideas } = signedIn();
    renderParents(account, ideas);
    act(() =>
      getDefaultStore().set(roomToParentsAtom, {
        type: 'PUT',
        parent: '!gone:example.org',
        children: [IDEAS],
        chatRoom: true,
      })
    );
    expect(shown()).toBe(GARDEN);
    expect(readOnce(ideas)).toEqual([GARDEN]);
  });

  it('renders again when the parent takes the room off its list, and when it lists it again', () => {
    const { account, garden, ideas } = signedIn();
    renderParents(account, ideas);
    expect(shown()).toBe(GARDEN);

    act(() => {
      garden.currentState.setStateEvents([stateEvent(GARDEN, 'm.space.child', IDEAS, {})]);
    });
    expect(shown()).toBe('');
    expect(readOnce(ideas)).toEqual([]);

    act(() => {
      garden.currentState.setStateEvents([stateEvent(GARDEN, 'm.space.child', IDEAS, VIA)]);
    });
    expect(shown()).toBe(GARDEN);
    expect(readOnce(ideas)).toEqual([GARDEN]);
  });

  it('offers sub-rooms in a chat room, not in a space or a direct chat', () => {
    const { account, garden, estate, ideas, withBob } = signedIn();
    renderParents(account, ideas);
    expect(offersSubRooms(garden)).toBe(true);
    expect(offersSubRooms(ideas)).toBe(true);
    expect(offersSubRooms(estate)).toBe(false);
    expect(offersSubRooms(withBob)).toBe(false);
  });
});
