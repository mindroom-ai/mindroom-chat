// A client plugin for the tests (docs/architecture.md "Client plugins"): a message that carries
// `com.example.greeting: { text }` shows as "<label>: <text>", with `label` from its config.json
// section (`plugins.example.label`), else from its strings: English here, German in locales/de.json,
// and "From <sender>" after the sender's avatar in the room, with ", a MindRoom agent" for an agent.
// Activity and the Threads page preview such a message as "Greeting: <text>" ("Gruß: <text>").
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
// Its name is a key of its strings ("Beispielbereich" in German). It may take the members list's
// place (`opensOverMembers`): as it opens again in its room, and beside a thread.
// A second side panel, "Example card", toggled from the room menu, draws its own frame: a plain
// card, 320 px wide beside the conversation and as wide as the room when it fills it or on a phone,
// with "Fill example card" ("Shrink example card" while it fills the room) and "Hide example card",
// which leaves only its tab, "Show example card", at the room's edge. The card says the kind of the
// app's theme ("Theme: light" or "Theme: dark") and the screen size the app lays out by ("Screen:
// Mobile", "Tablet" or "Desktop"), each as it changes, and "Show example PDF" previews a one-page
// PDF it builds as a blob, in the browser's viewer in the card. Its "Example pinch board" is a pinch
// surface (`usePinchSurface`): a pinch on it scales its box around the fingers, from the scale and
// centre the app hands it, and it says "Box scale: <scale>" and, while a pinch is on, "Pinching".
// Beside the conversation the card
// slides in and out as the room's panels do, also from the width of a panel whose place it takes;
// filling the room, folded, on a phone and under reduced motion it opens and closes at once.
// Under the room header it shows "Example banner in <room name>", after the mark it ships as a file
// (public/mark.svg); its build module (build.mjs) writes "Example banner" in place of a marker, which
// unit tests show as it is unless MINDROOM_CLIENT_PLUGINS lists it. The banner has a button, "Show
// example cover", that covers the room's conversation with "Example cover of <room name>" until its
// Close button or Escape closes it. Its panel also offers "Example item" to drag, in a drag type of
// its own, and the banner shows "Dropped: <text>" when one lands anywhere on the room header. Like a
// plugin outside this repository, it imports the app only through the client SDK.
// While the room shows a thread, the banner also says "Thread: <root event ID>", that thread's root
// also when the room's address names a reply in it, and nothing in the room's own timeline.
// A header action, "Wave" ("Winken" in German), shows in the room header's row, except on phones,
// where it goes in the room menu, and says where it ran in an alert.
// Its storage notes each greeting the signed-in account saw, when it shows and when it goes, and a
// greeting the account saw in an earlier page load also shows "Seen before".
// Its page at /p/example/ keeps the app's rail and links to its page at /p/example/window, which
// fills the window and links back. Its page at /p/example/rooms/<room ID>/<thread ID> links to that
// room and that thread, opens either, opens the room at the thread's root, opens the room in place
// of itself, and reloads the page into a new version.
// Its slash command, `/greet <text>`, sends the notice "Example greeting: <text>" to the room, or in a
// thread's composer to that thread, through the room's client, and refuses with its usage without a
// text, which the composer shows with its description. Its slash command `/subroom <name>` creates a
// sub-room of the room called <name>, as New Sub-room does, and refuses with its usage without a
// name, and fails in a space or a direct chat, where the room menu offers no New Sub-room. Its slash
// command `/topic <text>` sets the room's topic to <text> (without a text, clears it), and fails
// without sending anything where the room's levels, as they are when it runs, do not let the account.
// Its panel names the chat rooms its room is a sub-room of, as the room menu's Remove from does.
// Every room's menu but a space's lists its entry "Example room info" ("Beispiel-Rauminfo" in
// German), whose dialog says "Example dialog of <room name>" until its Close button closes it.
// Every room's menu also lists, after Leave and drawn as Leave is, its critical entry "Example
// removal" ("Beispiel-Entfernung" in German), which says in an alert which room it ran in.
// In a room with a MindRoom server, its panel also talks to the routes of e2e's sample MindRoom
// plugin (e2e/fixtures/sample-plugin/routes.py) as the signed-in user: "Say hello" asks for the
// backend's hello, and a websocket echoes what "Echo" sends, opened again unless the user left.
// "Show square" shows the image a route answers, and "Upload file" sends a file to a route with
// its progress, "Sent: <bytes> of <bytes>", and then the size the route answers. While the room's
// server is still being worked out, it says "Looking for a MindRoom server", and only then "No
// MindRoom server" in a room without one.
// In a room whose agents have a computer, by the rule of the room's own computer button, its panel
// names them after "Agents with a computer:", and "Open computer of <name>" opens a session on one:
// "Computer session: starting" until the server has it, then its state and mode ("ready, view").
// "Take computer control" opens the screen's stream and takes control ("ready, control"), "Release
// computer control" gives it back, and "End computer session" ends it on the server ("ended"), as
// the panel does when it goes or shows another room. A refusal shows "failed (<status>)".
// Its panel names the sender of the greeting it shows by the name the app shows for them, with their
// user ID when another member shows the same name (by their user ID when they have no name), and
// their name opens their profile card
// beside the panel, as a mention pill opens one; under it, the panel shows the signed-in person's
// card itself. It shows the greeting's text as the app renders an agent's reply, as Markdown whose
// HTML the app sanitized, with the Matrix IDs of the room's members replaced by their names.
// A third side panel, "Example thread", toggled from the room menu, shows the thread the room showed
// as it opened, as the room's page shows it (`ThreadView`), and keeps it while the room shows
// another; an Escape in it that nothing took, as on one of its rows, closes the panel, and one that
// closes the thread's menus, or a profile card its rows opened, leaves it open.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from 'react';
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
  color,
  config,
  type RectCords,
} from 'folds';
import { KnownMembership, type Room } from 'matrix-js-sdk';
import {
  commandUsage,
  getPluginTranslation,
  pluginPublicUrl,
  reloadForNewVersion,
  usePanelFrame,
  usePluginConfig,
  usePluginRouteHref,
  usePluginStorage,
  usePluginTranslation,
  useRoomSidePanel,
  type ClientPlugin,
  type MessageLinkCardProps,
  type PluginEvent,
  type PluginPageProps,
} from '@mindroom/client-sdk/core';
import {
  getMemberDisplayName,
  getRoomPermissions,
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
  offersSubRooms,
  UserProfileCard,
  useOpenUserProfile,
  useParentRooms,
  useRoomHref,
  useRoomNavigate,
  useShownThread,
  ThreadView,
} from '@mindroom/client-sdk/room';
import {
  ComputerApiError,
  MindroomServerError,
  useMindroomServerStatus,
  useRoomComputers,
  type ComputerSessionClient,
  type ComputerStatus,
  type RoomComputer,
} from '@mindroom/client-sdk/server';
import {
  animatePanel,
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
  pdfFrameUrl,
  replaceMatrixUserIdsWithDisplayNames,
  useMarkdownHtml,
  usePanelPresence,
  usePinchSurface,
  useScreenSize,
  useThemeKind,
  type PanelPhase,
  type PanelRegistration,
  type SurfacePinch,
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
  const thread = useShownThread();
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
      EXAMPLE_BANNER in {room.name}
      {thread !== undefined && <div data-example-plugin-thread>Thread: {thread}</div>}
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
  const { server, pending } = useMindroomServerStatus(roomId);
  const routes = `/api/plugins/e2e-sample/rooms/${encodeURIComponent(roomId)}`;
  const [hello, setHello] = useState<string>();
  const [socketOpen, setSocketOpen] = useState(false);
  const [lastClose, setLastClose] = useState<number>();
  const [echo, setEcho] = useState<string>();
  const [text, setText] = useState('');
  const [square, setSquare] = useState<string>();
  const [squareFailed, setSquareFailed] = useState<number>();
  const [sent, setSent] = useState<{ loaded: number; total: number }>();
  const [uploaded, setUploaded] = useState<string>();
  const socket = useRef<WebSocket>();
  useEffect(
    () => () => {
      if (square) URL.revokeObjectURL(square);
    },
    [square]
  );
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
  if (pending) return <p>Looking for a MindRoom server</p>;
  if (!server) return <p>No MindRoom server</p>;
  const sayHello = () => {
    server.request<{ hello: string }>(`${routes}/hello`).then(
      (answer) => setHello(answer.hello),
      (error: unknown) =>
        setHello(`failed (${error instanceof MindroomServerError ? error.status : 'error'})`)
    );
  };
  const showSquare = async () => {
    try {
      const response = await server.send(`${routes}/square.png`);
      if (!response.ok) setSquareFailed(response.status);
      else setSquare(URL.createObjectURL(await response.blob()));
    } catch {
      setSquareFailed(0);
    }
  };
  // `fetch` reports no upload progress, so the upload goes through XMLHttpRequest with the
  // session's token, asked for anew after a 401.
  const post = (file: File, token: string) =>
    new Promise<XMLHttpRequest>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${server.origin}${routes}/upload`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.addEventListener('progress', ({ loaded, total }) => setSent({ loaded, total }));
      xhr.addEventListener('load', () => resolve(xhr));
      xhr.addEventListener('error', () => reject(new Error('No answer')));
      const body = new FormData();
      body.append('file', file);
      xhr.send(body);
    });
  const uploadFile = async (file: File) => {
    setUploaded(undefined);
    try {
      const token = await server.token();
      let xhr = await post(file, token);
      if (xhr.status === 401) xhr = await post(file, await server.token({ refused: token }));
      if (xhr.status !== 200) throw new Error(String(xhr.status));
      const answer = JSON.parse(xhr.responseText) as { size: number };
      setUploaded(`${answer.size} bytes`);
    } catch (error) {
      setUploaded(`failed (${error instanceof Error ? error.message : 'error'})`);
    }
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
      <button type="button" onClick={() => void showSquare()}>
        Show square
      </button>
      {square !== undefined && <img src={square} alt="Square from MindRoom" width={32} />}
      {squareFailed !== undefined && <p>Square failed: {squareFailed}</p>}
      <input
        type="file"
        aria-label="Upload file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadFile(file);
        }}
      />
      {sent !== undefined && (
        <p>
          Sent: {sent.loaded} of {sent.total}
        </p>
      )}
      {uploaded !== undefined && <p>Uploaded: {uploaded}</p>}
    </>
  );
}

/**
 * The room's agents with a computer, and a session on the one chosen: its state and mode, control
 * taken (through the screen's stream, which control needs open) and released, and its end, also
 * when the panel goes. Nothing in a room without one.
 */
function RoomComputers({ roomId }: { roomId: string }) {
  const computers = useRoomComputers(roomId);
  const [session, setSession] = useState<ComputerSessionClient>();
  const [line, setLine] = useState<string>();
  const shown = useRef<{ session?: ComputerSessionClient; stream?: WebSocket }>({});
  // Aborted as the panel goes, so a session still opening then never arrives.
  const leaving = useRef<AbortSignal>();
  useEffect(() => {
    const gone = new AbortController();
    leaving.current = gone.signal;
    return () => {
      gone.abort();
      shown.current.stream?.close();
      shown.current.session?.dispose().catch(() => undefined);
    };
  }, []);
  if (computers.length === 0) return null;
  const show = (status: ComputerStatus) => setLine(`${status.state}, ${status.mode}`);
  const fail = (error: unknown) =>
    setLine(`failed (${error instanceof ComputerApiError ? error.status : 'error'})`);
  const open = async (computer: RoomComputer) => {
    setLine('starting');
    const signal = leaving.current;
    try {
      const opened = await computer.openSession(signal);
      if (signal?.aborted) {
        opened.dispose().catch(() => undefined);
        return;
      }
      shown.current.session = opened;
      setSession(opened);
      show(opened.status);
    } catch (error) {
      fail(error);
    }
  };
  // Releasing control closes the stream on the server, so each take opens one.
  const takeControl = async (current: ComputerSessionClient) => {
    try {
      shown.current.stream?.close();
      const { url, protocols } = await current.createStream();
      const stream = new WebSocket(url, protocols);
      shown.current.stream = stream;
      await new Promise((resolve, reject) => {
        stream.addEventListener('open', resolve);
        stream.addEventListener('close', () => reject(new Error('closed')));
      });
      show(await current.control('take'));
    } catch (error) {
      fail(error);
    }
  };
  const end = async (current: ComputerSessionClient) => {
    shown.current.stream?.close();
    shown.current = {};
    setSession(undefined);
    await current.dispose().then(() => setLine('ended'), fail);
  };
  return (
    <>
      <p>Agents with a computer: {computers.map(({ name }) => name).join(', ')}</p>
      {computers.map((computer) => (
        <button
          key={computer.userId}
          type="button"
          disabled={session !== undefined || line === 'starting'}
          onClick={() => void open(computer)}
        >
          Open computer of {computer.name}
        </button>
      ))}
      {line !== undefined && <p>Computer session: {line}</p>}
      {session && (
        <>
          <button type="button" onClick={() => void takeControl(session)}>
            Take computer control
          </button>
          <button type="button" onClick={() => void session.control('release').then(show, fail)}>
            Release computer control
          </button>
          <button type="button" onClick={() => void end(session)}>
            End computer session
          </button>
        </>
      )}
    </>
  );
}

/**
 * A greeting's text as the app renders an agent's reply, Markdown with its HTML sanitized, and with
 * the room's members by name; plain until the app's Markdown renderer has loaded.
 */
function GreetingText({ room, text }: { room: Room | null; text: string }) {
  const named = room ? replaceMatrixUserIdsWithDisplayNames(room, text) : text;
  const html = useMarkdownHtml(named);
  if (html === undefined) return <p>{named}</p>;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
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
  const room = client.getRoom(roomId);
  return (
    <>
      <div data-example-plugin-greeting>
        Greeting: <GreetingText room={room} text={text} />
      </div>
      {sender && (
        <p>
          From{' '}
          <button
            type="button"
            onClick={(event) =>
              openUserProfile(roomId, sender, event.currentTarget.getBoundingClientRect(), 'Left')
            }
          >
            {(room && getMemberDisplayName(room, sender)) ?? sender}
          </button>
        </p>
      )}
    </>
  );
}

/** A one-page PDF that says "Example PDF", with the cross-reference table a viewer reads. */
const examplePdf = (): Blob => {
  const text = 'BT /F1 24 Tf 24 40 Td (Example PDF) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  const size = objects.length + 1;
  const xref = pdf.length;
  pdf += `xref\n0 ${size}\n0000000000 65535 f \n${offsets.join('')}`;
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([pdf], { type: 'application/pdf' });
};

/** Its PDF, built as a blob, in the browser's viewer through the app's frame page. */
function ExamplePdf() {
  const [objectUrl, setObjectUrl] = useState<string>();
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl]
  );
  const frameUrl = objectUrl && pdfFrameUrl(objectUrl);
  if (!frameUrl) {
    return (
      <button type="button" onClick={() => setObjectUrl(URL.createObjectURL(examplePdf()))}>
        Show example PDF
      </button>
    );
  }
  return (
    <iframe
      title="Example PDF"
      src={frameUrl}
      style={{ display: 'block', width: '100%', height: 240, border: 'none' }}
    />
  );
}

/**
 * Its pinch board: a pinch on it scales its box around the pinch's centre, which keeps the point of
 * the box under it where the pinch started, from the box's scale and place at that start.
 */
function PinchBoard() {
  const board = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, x: 0, y: 0 });
  const [pinching, setPinching] = useState(false);
  const boxNow = useRef(box);
  const pinchStart = useRef<{ box: typeof box; x: number; y: number }>();
  usePinchSurface(board, {
    onPinch: ({ phase, scale, centre }: SurfacePinch) => {
      const rect = board.current?.getBoundingClientRect();
      const [x, y] = [centre.x - (rect?.left ?? 0), centre.y - (rect?.top ?? 0)];
      if (phase === 'start') pinchStart.current = { box: boxNow.current, x, y };
      setPinching(phase !== 'end');
      const start = pinchStart.current;
      if (!start) return;
      const next = {
        scale: start.box.scale * scale,
        x: x - (start.x - start.box.x) * scale,
        y: y - (start.y - start.box.y) * scale,
      };
      boxNow.current = next;
      setBox(next);
    },
  });
  return (
    <>
      <div
        ref={board}
        role="group"
        aria-label="Example pinch board"
        style={{
          position: 'relative',
          height: 160,
          overflow: 'hidden',
          border: `1px solid ${color.Surface.ContainerLine}`,
        }}
      >
        <div
          data-example-pinch-box
          style={{
            position: 'absolute',
            // At the board's top left corner in either reading direction: its place and the
            // pinch's centre are both in client coordinates.
            // eslint-disable-next-line no-restricted-syntax
            left: 0,
            top: 0,
            width: 60,
            height: 60,
            background: color.Primary.Main,
            transformOrigin: '0 0',
            transform: `translate(${box.x}px, ${box.y}px) scale(${box.scale})`,
          }}
        />
      </div>
      <p>Box scale: {box.scale.toFixed(2)}</p>
      {pinching && <p>Pinching</p>}
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

/** The chat rooms `room` is a sub-room of, which it follows as their lists change. */
function ParentRooms({ room }: { room: Room }) {
  const parents = useParentRooms(room);
  if (parents.length === 0) return null;
  return <p>Sub-room of {parents.map(({ name }) => name).join(', ')}</p>;
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
      {/* Kept whole in a panel shorter than what it shows, which scrolls then. */}
      <Box alignItems="Center" justifyContent="SpaceBetween" gap="200" shrink="No">
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
      {room && <ParentRooms room={room} />}
      {typeof request === 'string' && (
        <FetchedGreeting key={request} roomId={roomId} eventId={request} />
      )}
      <p draggable onDragStart={(event) => event.dataTransfer.setData(ITEM_TYPE, 'Example item')}>
        Example item
      </p>
      <ServerGreeting roomId={roomId} />
      {/* A session belongs to its room, so another room's panel starts without one. */}
      <RoomComputers key={roomId} roomId={roomId} />
      {room && (
        <div data-example-plugin-own-card>
          <UserProfileCard room={room} userId={client.getSafeUserId()} onDone={() => undefined} />
        </div>
      )}
    </>
  );
}

/** The thread the room showed as the panel opened, kept while the room shows another. */
function ExampleThread({ roomId }: { roomId: string }) {
  const client = useMatrixClient();
  const [threadId] = useState(useShownThread());
  const panel = useRoomSidePanel('example', 'thread');
  const boxRef = useRef<HTMLDivElement>(null);
  const close = panel?.close;
  // On the window, which the thread's menus and the profile card its rows open let no Escape of
  // theirs reach: the document is where they take it, after it bubbled through this panel.
  useEffect(() => {
    if (!close) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!(event.target instanceof Node) || !boxRef.current?.contains(event.target)) return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [close]);
  const room = client.getRoom(roomId);
  if (!room || !threadId) return <p>No example thread</p>;
  return (
    <div
      ref={boxRef}
      style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}
    >
      <ThreadView room={room} threadId={threadId} />
    </div>
  );
}

// The card's width: its own beside the conversation, the room's when it fills it or on a phone. Its
// box, the card and its margins, clips it: the box moves in and out, and the card keeps its width.
const CARD_WIDTH = 320;
const CARD_MARGIN = 8;
const CARD_CSS = `[data-example-card-box] { display: flex; flex: none; width: ${
  CARD_WIDTH + 2 * CARD_MARGIN
}px; overflow: clip; }
[data-example-card] { flex: none; width: ${CARD_WIDTH}px; }
[data-example-card-box][data-filled], [data-filled] > [data-example-card] { flex: 1 1 0; }
@media (max-width: 750px) { [data-example-card-box], [data-example-card] { flex: 1 1 0; } }`;

/**
 * Moves the card's box in and out, when `moves`, as the room moves its panels: it registers with the
 * room's panel place, which then keeps the closing card until it calls `done`.
 */
function useCardMotion(box: RefObject<HTMLElement>, moves: boolean) {
  const presence = usePanelPresence();
  const register = presence?.register;
  const lastWidth = presence?.lastWidth;
  const moving = useRef(moves);
  const registration = useRef<PanelRegistration>();
  useLayoutEffect(() => {
    const own = register?.();
    registration.current = own;
    return () => {
      own?.();
      // As from a room's panel, a panel that takes the card's place moves on from its width if it
      // moved: the box on the page as it goes, which React lets go of only after this (hidden and
      // shown again, it has a new box).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (lastWidth) lastWidth.current = moving.current ? box.current?.offsetWidth : undefined;
    };
  }, [box, lastWidth, register]);
  const phase = presence?.phase ?? 'shown';
  const phaseSeen = useRef<PanelPhase>('shown');
  const motion = useRef<Animation>();
  useLayoutEffect(() => {
    moving.current = moves;
    if (phase === phaseSeen.current) return;
    phaseSeen.current = phase;
    const element = box.current;
    // Turned around as it moves, it moves on from where it is.
    const now = motion.current?.playState === 'running' ? element?.offsetWidth : undefined;
    motion.current?.cancel();
    motion.current = undefined;
    if (moves && element) {
      const width = element.offsetWidth;
      const size = (pixels: number) => ({ width: pixels, gap: 0 });
      // In from nothing, or from the width of the panel whose place it takes; out to nothing.
      const from = phase === 'swap' ? lastWidth?.current ?? width : 0;
      motion.current =
        phase === 'exit'
          ? animatePanel(element, size(now ?? width), size(0), true)
          : animatePanel(element, size(now ?? from), size(width), false);
    }
    if (phase !== 'exit') return;
    // Its registration's `done`, which ends nothing once the card has gone.
    const done = registration.current?.done;
    if (motion.current) void motion.current.finished.then(done, () => undefined);
    else done?.();
  }, [box, lastWidth, moves, phase]);
}

/**
 * The panel that draws its own frame: a card with Fill and Hide, the app's theme kind and screen
 * size, and its PDF, and a tab while hidden.
 */
function ExampleCard() {
  const frame = usePanelFrame();
  const themeKind = useThemeKind();
  const screenSize = useScreenSize();
  const box = useRef<HTMLDivElement>(null);
  // As the room's panels, it moves only beside the conversation, never filling the room or on a phone.
  useCardMotion(box, frame?.layout === 'beside' && screenSize !== 'Mobile');
  if (!frame) return null;
  const { layout, setLayout } = frame;
  const look = {
    margin: CARD_MARGIN,
    padding: 16,
    borderRadius: 8,
    border: `1px solid ${color.Surface.ContainerLine}`,
    background: color.Surface.Container,
    color: color.Surface.OnContainer,
  };
  if (layout === 'folded') {
    return (
      <button
        type="button"
        onClick={() => setLayout('beside')}
        style={{ ...look, writingMode: 'vertical-rl' }}
      >
        Show example card
      </button>
    );
  }
  const filled = layout === 'filled';
  return (
    <div ref={box} data-example-card-box data-filled={filled || undefined}>
      <style>{CARD_CSS}</style>
      <section aria-label="Example card" data-example-card style={look}>
        <h2>Example card</h2>
        <button type="button" onClick={() => setLayout(filled ? 'beside' : 'filled')}>
          {filled ? 'Shrink example card' : 'Fill example card'}
        </button>
        <button type="button" onClick={() => setLayout('folded')}>
          Hide example card
        </button>
        <p>Theme: {themeKind}</p>
        <p>Screen: {screenSize}</p>
        <ExamplePdf />
        <PinchBoard />
      </section>
    </div>
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

/** The card a click on a link to an item of example.org shows. */
function ItemCard({ href, close }: MessageLinkCardProps) {
  const panel = useRoomSidePanel('example', 'panel');
  const id = new URL(href).pathname.split('/').pop();
  return (
    <div data-example-item-card>
      <div>Example item {id}</div>
      {panel && (
        <button
          type="button"
          onClick={() => {
            panel.open(undefined);
            close();
          }}
        >
          Show item in panel
        </button>
      )}
    </div>
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
    {
      match: (event) => greetingText(event.content) !== undefined,
      Component: Greeting,
      preview: (event) => {
        const text = greetingText(event.content);
        return text && getPluginTranslation('example')('preview', { text });
      },
    },
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
      label: 'panel',
      icon: Icons.Leaf,
      placement: 'auto',
      Component: ExamplePanel,
      remember: true,
      opensOverMembers: true,
    },
    { id: 'card', label: 'Example card', Component: ExampleCard, frame: 'own' },
    { id: 'thread', label: 'Example thread', Component: ExampleThread },
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
      name: 'topic',
      description: 'topic',
      run: async ({ room, args }) => {
        if (!getRoomPermissions(room).stateEvent('m.room.topic', room.client.getSafeUserId())) {
          throw new Error("You may not change this room's topic.");
        }
        await room.client.setRoomTopic(room.roomId, args.trim());
      },
    },
    {
      name: 'greet',
      description: 'greet',
      run: async ({ room, args, threadId }) => {
        if (!args.trim()) throw commandUsage();
        await room.client.sendNotice(room.roomId, threadId ?? null, `Example greeting: ${args}`);
      },
    },
    {
      name: 'subroom',
      description: 'subroom',
      run: async ({ room, args }) => {
        if (!offersSubRooms(room)) {
          throw new Error('Sub-rooms go in chat rooms, not in spaces or direct chats.');
        }
        if (!args.trim()) throw commandUsage();
        await createSubRoom(room, { name: args });
      },
    },
  ],
  messageLinks: [
    {
      match: (url) => url.hostname === 'example.org' && /^\/items\/[^/]+$/.test(url.pathname),
      Component: ItemCard,
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
      panel: 'Example panel',
      wave: 'Wave',
      greet: 'Send the room a greeting. Example: /greet Hello',
      subroom: 'Create a sub-room of this room. Example: /subroom Ideas',
      topic: "Set this room's topic, where you may. Example: /topic Plans for today",
      roomInfo: 'Example room info',
      roomRemoval: 'Example removal',
      preview: 'Greeting: {{text}}',
    },
    load: async (language) =>
      language === 'de' ? (await import('./locales/de.json')).default : undefined,
  },
};

export default plugin;
