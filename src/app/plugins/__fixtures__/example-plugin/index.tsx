// A client plugin for the tests (docs/architecture.md "Client plugins"): a message that carries
// `com.example.greeting: { text }` shows as "<label>: <text>", with `label` from its config.json
// section (`plugins.example.label`), else from its strings: English here, German in locales/de.json,
// and "From <sender>" after the sender's avatar in the room, with ", a MindRoom agent" for an agent.
// A side panel, "Example panel", names the room it is open in, counts its joined members and says
// whether a MindRoom agent has joined or is invited, through the account's client, and whether the
// account may post there, which it says again when the room's levels change. Under "Example rows"
// it draws its rows, "First example row" and "Second example row", as the sidebar draws its rows,
// and marks the one chosen; its button "Example menu", beside that title, opens a menu drawn as the
// room menu is, in a pop-out under it lined up with its end, as is its tooltip: "Show example
// dialog" opens the dialog of its room entry (below), and "Clear example selection" unmarks the
// row. They are the app's own pieces, from the client SDK's `ui` subpath, so they look like the
// app's and mirror in right-to-left languages.
// Its toggle, under a leaf icon, shows in the room header's row, except on phones, where it goes in
// the room menu. It also shows the greeting a card asked it to show: in a room, each greeting has
// "Show in panel", and "Close panel" while the panel shows. A greeting that begins a thread opens
// the panel beside that thread as the thread shows. The panel stays open in its room across reloads
// (`remember`), so a card hands it only the greeting's event ID, and it reads the greeting itself.
// Under the room header it shows "Example banner in <room name>", after the mark it ships as a file
// (public/mark.svg), and a button, "Show example cover", that covers the room's conversation with
// "Example cover of <room name>" until its Close button or Escape closes it. Its panel also offers
// "Example item" to drag, in a drag type of its own, and the banner shows "Dropped: <text>" when
// one lands anywhere on the room header. Like a plugin outside this repository, it imports the app
// only through the client SDK.
// A header action, "Wave" ("Winken" in German), shows in the room header's row, except on phones,
// where it goes in the room menu, and says where it ran in an alert.
// Its storage notes each greeting the signed-in account saw, when it shows and when it goes, and a
// greeting the account saw in an earlier page load also shows "Seen before".
// Its page at /p/example/ keeps the app's rail and links to its page at /p/example/window, which
// fills the window and links back. Its page at /p/example/rooms/<room ID>/<thread ID> links to that
// room and that thread, opens either, opens the room at the thread's root, opens the room in place
// of itself, and reloads the page into a new version.
// Its slash command, `/greet <text>`, sends the notice "Example greeting: <text>" to the room, or in a
// thread's composer to that thread, through the room's client, and fails without a text. Its slash
// command `/subroom <name>` creates a sub-room of the room called <name>, as New Sub-room does, and
// fails without a name.
// Every room's menu but a space's lists its entry "Example room info" ("Beispiel-Rauminfo" in
// German), whose dialog says "Example dialog of <room name>" until its Close button closes it.
// Every room's menu also lists, after Leave and drawn as Leave is, its critical entry "Example
// removal" ("Beispiel-Entfernung" in German), which says in an alert which room it ran in.
// In a room with a MindRoom server, its panel also talks to the routes of e2e's sample MindRoom
// plugin (e2e/fixtures/sample-plugin/routes.py) as the signed-in user: "Say hello" asks for the
// backend's hello, and a websocket echoes what "Echo" sends, opened again unless the user left.
// Its panel names the sender of the greeting it shows, and their name opens their profile card
// beside the panel, as a mention pill opens one; under it, the panel shows the signed-in person's
// card itself.
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import FocusTrap from 'focus-trap-react';
import {
  Avatar,
  Box,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  config,
  type RectCords,
} from 'folds';
import { KnownMembership, type Room } from 'matrix-js-sdk';
import {
  pluginPublicUrl,
  reloadForNewVersion,
  usePluginConfig,
  usePluginRouteHref,
  usePluginStorage,
  usePluginTranslation,
  useRoomSidePanel,
  type ClientPlugin,
  type PluginEvent,
  type PluginPageProps,
} from '@mindroom/client-sdk/core';
import {
  hasActiveMindroomAgent,
  isMindroomAgentUserId,
  mxcUrlToHttp,
  useMatrixClient,
  useMediaAuthentication,
  useRoomMembers,
  useRoomPermissions,
} from '@mindroom/client-sdk/matrix';
import {
  createSubRoom,
  UserProfileCard,
  useOpenUserProfile,
  useRoomHref,
  useRoomNavigate,
} from '@mindroom/client-sdk/room';
import { MindroomServerError, useMindroomServer } from '@mindroom/client-sdk/server';
import {
  Dialog,
  Header,
  IconButton,
  IconTooltip,
  Menu,
  MenuEntry,
  MenuGroup,
  NavButton,
  NavItem,
  NavItemContent,
  PopOut,
} from '@mindroom/client-sdk/ui';

/** The drag type of the item its panel offers, which the room header takes. */
const ITEM_TYPE = 'application/x-example-item';
const ITEM_DRAG_EVENTS = ['dragenter', 'dragover', 'drop'] as const;

/** This page load; what the plugin stored in it does not count as seen before. */
const pageLoad = `${Date.now()}-${Math.random()}`;

const greetingText = (content: PluginEvent['content']): string | undefined => {
  const greeting = content['com.example.greeting'];
  if (typeof greeting !== 'object' || greeting === null || !('text' in greeting)) return undefined;
  return typeof greeting.text === 'string' ? greeting.text : undefined;
};

function Greeting({ event }: { event: PluginEvent }) {
  const config = usePluginConfig('example');
  const storage = usePluginStorage('example');
  const seenKey = `seen:${event.eventId ?? ''}`;
  const seenIn = storage.getItem(seenKey);
  useEffect(() => {
    const note = () => {
      if (storage.getItem(seenKey) === null) storage.setItem(seenKey, pageLoad);
    };
    note();
    // Notes it again as it goes, as a plugin that saves when it unmounts would.
    return note;
  }, [storage, seenKey]);
  const t = usePluginTranslation('example');
  const panel = useRoomSidePanel('example', 'panel');
  const client = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const avatarMxc = client.getRoom(event.roomId)?.getMember(event.sender)?.getMxcAvatarUrl();
  const avatar = avatarMxc && mxcUrlToHttp(client, avatarMxc, authenticated, 32, 32, 'crop');
  const openBesideThread = panel?.openBesideThread;
  const { eventId } = event;
  // As the root of the thread the room shows, it opens the panel beside that thread.
  useEffect(() => {
    if (eventId) openBesideThread?.(eventId, eventId);
  }, [eventId, openBesideThread]);
  const text = greetingText(event.content);
  const label =
    typeof config === 'object' &&
    config !== null &&
    'label' in config &&
    typeof config.label === 'string'
      ? config.label
      : t('label');
  return (
    <>
      <div data-example-plugin>
        {label}: {text}
      </div>
      <div data-example-plugin-sender>
        {avatar && <img src={avatar} alt="" width={16} height={16} />}
        From {event.sender}
        {isMindroomAgentUserId(event.sender) && ', a MindRoom agent'}
      </div>
      {seenIn !== null && seenIn !== pageLoad && <div data-example-plugin-seen>Seen before</div>}
      {panel && (
        <button type="button" onClick={() => panel.open(event.eventId)}>
          Show in panel
        </button>
      )}
      {panel?.isOpen && (
        <button type="button" onClick={panel.close}>
          Close panel
        </button>
      )}
    </>
  );
}

function RoomBanner({ room, headerRef }: { room: Room; headerRef: RefObject<HTMLElement> }) {
  const [dropped, setDropped] = useState<string>();
  // The header's element is set by the time effects run; a drag of its item may drop anywhere on it.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return undefined;
    // Takes only its own item, so a drag of files goes on to the composer.
    const take = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(ITEM_TYPE)) return;
      event.preventDefault();
      if (event.type === 'drop') setDropped(event.dataTransfer.getData(ITEM_TYPE));
    };
    ITEM_DRAG_EVENTS.forEach((type) => header.addEventListener(type, take));
    return () => ITEM_DRAG_EVENTS.forEach((type) => header.removeEventListener(type, take));
  }, [headerRef]);
  return (
    <div data-example-plugin-banner style={{ paddingBlock: 8, paddingInline: 16 }}>
      <img
        src={`${pluginPublicUrl('example')}mark.svg`}
        alt=""
        width={16}
        height={16}
        style={{ marginInlineEnd: 8, verticalAlign: 'middle' }}
      />
      Example banner in {room.name}
      {dropped !== undefined && <div data-example-plugin-dropped>Dropped: {dropped}</div>}
    </div>
  );
}

function ExamplePage() {
  return (
    <div data-example-page>
      <h1>Example page</h1>
      <a href={usePluginRouteHref('example', 'window')}>Fill the window</a>
    </div>
  );
}

function WindowPage() {
  return (
    <div data-example-window-page>
      <h1>Example window page</h1>
      <a href={usePluginRouteHref('example')}>Back to the rail</a>
    </div>
  );
}

function RoomPage({ params: { roomId = '', threadId = '' } }: PluginPageProps) {
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  return (
    <div data-example-room-page>
      <a href={useRoomHref(roomId)}>Link to the room</a>
      <a href={useRoomHref(roomId, threadId)}>Link to the thread</a>
      <button type="button" onClick={() => navigateRoom(roomId)}>
        Open the room
      </button>
      <button type="button" onClick={() => navigateRoomThread(roomId, threadId)}>
        Open the thread
      </button>
      <button type="button" onClick={() => navigateRoom(roomId, { eventId: threadId })}>
        Open the room at the thread root
      </button>
      <button type="button" onClick={() => navigateRoom(roomId, { replace: true })}>
        Open the room in place of this page
      </button>
      <button type="button" onClick={() => void reloadForNewVersion()}>
        Reload into the new version
      </button>
    </div>
  );
}

function PostingRight({ room }: { room: Room }) {
  const mayPost = useRoomPermissions(room).event('m.room.message', room.client.getSafeUserId());
  return <p>{mayPost ? 'You may post here' : 'You may not post here'}</p>;
}

function ServerGreeting({ roomId }: { roomId: string }) {
  const server = useMindroomServer(roomId);
  const routes = `/api/plugins/e2e-sample/rooms/${encodeURIComponent(roomId)}`;
  const [hello, setHello] = useState<string>();
  const [socketOpen, setSocketOpen] = useState(false);
  const [lastClose, setLastClose] = useState<number>();
  const [echo, setEcho] = useState<string>();
  const [text, setText] = useState('');
  const socket = useRef<WebSocket>();
  useEffect(() => {
    if (!server) return undefined;
    let mounted = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // The plugin reconnects itself, a second after a failed open or any close but 1008 (the user
    // left the room): after its session ended (4401), a plugin reload (1012), a refused handshake.
    const open = () => {
      server.openSocket(`${routes}/echo`).then(
        (opened) => {
          if (!mounted) {
            opened.close();
            return;
          }
          socket.current = opened;
          opened.addEventListener('open', () => setSocketOpen(true));
          opened.addEventListener('message', ({ data }) => setEcho(String(data)));
          opened.addEventListener('close', ({ code }) => {
            // A socket this effect no longer owns, closing late, leaves the next one's state alone.
            if (!mounted) return;
            setSocketOpen(false);
            setLastClose(code);
            if (code !== 1008) retry = setTimeout(open, 1000);
          });
        },
        () => {
          if (mounted) retry = setTimeout(open, 1000);
        }
      );
    };
    open();
    return () => {
      mounted = false;
      clearTimeout(retry);
      socket.current?.close();
      setSocketOpen(false);
    };
  }, [server, routes]);
  if (!server) return <p>No MindRoom server</p>;
  const sayHello = () => {
    server.request<{ hello: string }>(`${routes}/hello`).then(
      (answer) => setHello(answer.hello),
      (error: unknown) =>
        setHello(`failed (${error instanceof MindroomServerError ? error.status : 'error'})`)
    );
  };
  return (
    <>
      <p>MindRoom server: {server.origin}</p>
      <button type="button" onClick={sayHello}>
        Say hello
      </button>
      {hello !== undefined && <p>Hello: {hello}</p>}
      <p>Socket: {socketOpen ? 'open' : 'closed'}</p>
      {lastClose !== undefined && <p>Last close: {lastClose}</p>}
      <input
        aria-label="Echo text"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="button" disabled={!socketOpen} onClick={() => socket.current?.send(text)}>
        Echo
      </button>
      {echo !== undefined && <p>Echo: {echo}</p>}
    </>
  );
}

/**
 * The greeting of the message `eventId` in the room, as the homeserver has it (the tests' greetings
 * are not encrypted), and its sender's name, which opens their profile card beside the panel.
 */
function FetchedGreeting({ roomId, eventId }: { roomId: string; eventId: string }) {
  const client = useMatrixClient();
  const openUserProfile = useOpenUserProfile();
  const [greeting, setGreeting] = useState<{ text?: string; sender?: string }>({});
  useEffect(() => {
    let current = true;
    client
      .fetchRoomEvent(roomId, eventId)
      .then((event) => {
        if (current) setGreeting({ text: greetingText(event.content ?? {}), sender: event.sender });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, eventId, roomId]);
  const { text, sender } = greeting;
  if (text === undefined) return null;
  return (
    <>
      <p>Greeting: {text}</p>
      {sender && (
        <p>
          From{' '}
          <button
            type="button"
            onClick={(event) =>
              openUserProfile(roomId, sender, event.currentTarget.getBoundingClientRect(), 'Left')
            }
          >
            {client.getRoom(roomId)?.getMember(sender)?.name ?? sender}
          </button>
        </p>
      )}
    </>
  );
}

const ROWS = ['First example row', 'Second example row'];

/** Its menu's button, and the menu, which Escape and a click outside close, as the room menu's. */
function ExampleMenu({ onShowDialog, onClear }: { onShowDialog: () => void; onClear: () => void }) {
  const [anchor, setAnchor] = useState<RectCords>();
  const close = () => {
    setAnchor(undefined);
    return true;
  };
  const choose = (act: () => void) => () => {
    close();
    act();
  };
  return (
    <>
      <IconTooltip label="Example menu" align="End">
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            size="300"
            radii="300"
            aria-label="Example menu"
            aria-haspopup="menu"
            aria-expanded={anchor !== undefined}
            onClick={(event: MouseEvent<HTMLButtonElement>) =>
              setAnchor(event.currentTarget.getBoundingClientRect())
            }
          >
            <Icon size="200" src={Icons.VerticalDots} />
          </IconButton>
        )}
      </IconTooltip>
      <PopOut
        anchor={anchor}
        position="Bottom"
        align="End"
        offset={4}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              clickOutsideDeactivates: close,
              escapeDeactivates: close,
            }}
          >
            <Menu>
              <MenuGroup>
                <MenuEntry
                  label="Show example dialog"
                  icon={Icons.Info}
                  onSelect={choose(onShowDialog)}
                />
                <MenuEntry
                  label="Clear example selection"
                  icon={Icons.Cross}
                  onSelect={choose(onClear)}
                />
              </MenuGroup>
            </Menu>
          </FocusTrap>
        }
      />
    </>
  );
}

function ExamplePanel({ roomId, request }: { roomId: string; request?: unknown }) {
  const client = useMatrixClient();
  const members = useRoomMembers(client, roomId);
  const room = client.getRoom(roomId);
  const joined = members.filter(({ membership }) => membership === KnownMembership.Join);
  const [selected, setSelected] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <>
      {/* A room ID breaks anywhere, so it never widens the panel past its edge. */}
      <p style={{ overflowWrap: 'anywhere' }}>Example panel of {roomId}</p>
      <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
        <Text size="L400">Example rows</Text>
        <ExampleMenu
          onShowDialog={() => setDialogOpen(true)}
          onClear={() => setSelected(undefined)}
        />
      </Box>
      {ROWS.map((row) => (
        <NavItem key={row} variant="Background" radii="400" aria-selected={row === selected}>
          <NavButton onClick={() => setSelected(row)}>
            <NavItemContent>
              <Box as="span" alignItems="Center" gap="200" grow="Yes">
                <Avatar radii="400" size="200">
                  <Icon size="100" src={Icons.Leaf} />
                </Avatar>
                <Text as="span" size="Inherit" truncate>
                  {row}
                </Text>
              </Box>
            </NavItemContent>
          </NavButton>
        </NavItem>
      ))}
      {dialogOpen && room && <RoomDialog room={room} close={() => setDialogOpen(false)} />}
      <p>
        Members: {joined.length}, {hasActiveMindroomAgent(members) ? 'with' : 'without'} a MindRoom
        agent
      </p>
      {room && <PostingRight room={room} />}
      {typeof request === 'string' && (
        <FetchedGreeting key={request} roomId={roomId} eventId={request} />
      )}
      <p draggable onDragStart={(event) => event.dataTransfer.setData(ITEM_TYPE, 'Example item')}>
        Example item
      </p>
      <ServerGreeting roomId={roomId} />
      {room && (
        <div data-example-plugin-own-card>
          <UserProfileCard room={room} userId={client.getSafeUserId()} onDone={() => undefined} />
        </div>
      )}
    </>
  );
}

// The rooms whose cover is open, and who wants to hear when that changes.
const coveredRooms = new Set<string>();
const coverListeners = new Set<() => void>();
const setCovered = (roomId: string, covered: boolean) => {
  if (covered) coveredRooms.add(roomId);
  else coveredRooms.delete(roomId);
  coverListeners.forEach((listener) => listener());
};

function CoverButton({ room }: { room: Room }) {
  return (
    <button type="button" onClick={() => setCovered(room.roomId, true)}>
      Show example cover
    </button>
  );
}

function ExampleCover({ room }: { room: Room }) {
  return (
    <div data-example-plugin-cover style={{ padding: 16 }}>
      <h2>Example cover of {room.name}</h2>
      <input aria-label="Example cover note" />
      <button type="button" onClick={() => setCovered(room.roomId, false)}>
        Close example cover
      </button>
    </div>
  );
}

function RoomDialog({ room, close }: { room: Room; close: () => void }) {
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <Dialog role="dialog" aria-label="Example dialog">
          <Header size="500" style={{ paddingInline: `${config.space.S400} ${config.space.S200}` }}>
            <Text size="H4" style={{ flexGrow: 1 }}>
              Example dialog
            </Text>
            <IconButton aria-label="Close example dialog" size="300" radii="300" onClick={close}>
              <Icon src={Icons.Cross} size="200" />
            </IconButton>
          </Header>
          <Text size="T300" style={{ padding: config.space.S400 }}>
            Example dialog of {room.name}
          </Text>
        </Dialog>
      </OverlayCenter>
    </Overlay>
  );
}

const plugin: ClientPlugin = {
  conversationCovers: [
    {
      covers: (room) => coveredRooms.has(room.roomId),
      subscribe: (_room, onChange) => {
        coverListeners.add(onChange);
        return () => {
          coverListeners.delete(onChange);
        };
      },
      Component: ExampleCover,
      close: (room) => setCovered(room.roomId, false),
    },
  ],
  messageRenderers: [
    { match: (event) => greetingText(event.content) !== undefined, Component: Greeting },
  ],
  pages: [
    { path: '', Component: ExamplePage },
    { path: 'window', Component: WindowPage, fillsWindow: true },
    { path: 'rooms/:roomId/:threadId', Component: RoomPage },
  ],
  // It keeps nothing outside its storage, which the app deletes itself; for the tests, it notes the
  // account it was asked to forget in this tab.
  forgetAccount: (userId) => {
    sessionStorage.setItem('example-plugin.forgot', userId);
  },
  roomHeaderSlot: [RoomBanner, CoverButton],
  sidePanels: [
    {
      id: 'panel',
      label: 'Example panel',
      icon: Icons.Leaf,
      placement: 'auto',
      Component: ExamplePanel,
      remember: true,
    },
  ],
  headerActions: [
    {
      id: 'wave',
      label: 'wave',
      icon: Icons.Smile,
      placement: 'auto',
      run: ({ roomId, threadId }) => {
        // eslint-disable-next-line no-alert
        window.alert(`Example wave in ${roomId}${threadId ? ` ${threadId}` : ''}`);
      },
    },
  ],
  slashCommands: [
    {
      name: 'greet',
      description: 'greet',
      run: async ({ room, args, threadId }) => {
        if (!args.trim()) throw new Error('Type a greeting after /greet.');
        await room.client.sendNotice(room.roomId, threadId ?? null, `Example greeting: ${args}`);
      },
    },
    {
      name: 'subroom',
      description: 'subroom',
      run: async ({ room, args }) => {
        if (!args.trim()) throw new Error('Type a name after /subroom.');
        await createSubRoom(room, { name: args });
      },
    },
  ],
  roomActions: [
    {
      id: 'info',
      label: 'roomInfo',
      icon: Icons.Info,
      shows: (room) => !room.isSpaceRoom(),
      run: ({ room, showDialog }) =>
        showDialog((close) => <RoomDialog room={room} close={close} />),
    },
    {
      id: 'removal',
      label: 'roomRemoval',
      icon: Icons.Delete,
      critical: true,
      run: ({ room }) => {
        window.alert(`Example removal in ${room.roomId}`);
      },
    },
  ],
  translations: {
    en: {
      label: 'Example plugin',
      wave: 'Wave',
      greet: 'Send the room a greeting. Example: /greet Hello',
      subroom: 'Create a sub-room of this room. Example: /subroom Ideas',
      roomInfo: 'Example room info',
      roomRemoval: 'Example removal',
    },
    load: async (language) =>
      language === 'de' ? (await import('./locales/de.json')).default : undefined,
  },
};

export default plugin;
