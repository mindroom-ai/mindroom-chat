// A client plugin for the tests (docs/architecture.md "Client plugins"): a message that carries
// `com.example.greeting: { text }` shows as "<label>: <text>", with `label` from its config.json
// section (`plugins.example.label`), else from its strings: English here, German in locales/de.json.
// A side panel, "Example panel", names the room it is open in, counts its joined members and says
// whether a MindRoom agent has joined or is invited, through the account's client. It also shows
// the greeting a card asked it to show: in a room, each greeting has "Show in panel", and "Close
// panel" while the panel shows. The panel stays open in its room across reloads (`remember`).
// Under the room header it shows "Example banner in <room name>", after the mark it ships as a file
// (public/mark.svg), and a button, "Show example cover", that covers the room's conversation with
// "Example cover of <room name>" until its Close button or Escape closes it. Like a plugin outside
// this repository, it imports the app only through the client SDK.
// A header action, "Wave" ("Winken" in German), shows in the room header's row, except on phones,
// where it goes in the room menu, and says where it ran in an alert.
// Its storage notes each greeting the signed-in account saw, when it shows and when it goes, and a
// greeting the account saw in an earlier page load also shows "Seen before".
// Its page at /p/example/ keeps the app's rail and links to its page at /p/example/window, which
// fills the window and links back. Its page at /p/example/rooms/<room ID>/<thread ID> links to that
// room and that thread, opens either, and reloads the page into a new version.
// Its slash command, `/greet <text>`, sends the notice "Example greeting: <text>" to the room, or in a
// thread's composer to that thread, through the room's client, and fails without a text.
import { useEffect } from 'react';
import { Icons } from 'folds';
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
  useMatrixClient,
  useRoomMembers,
} from '@mindroom/client-sdk/matrix';
import { useRoomHref, useRoomNavigate } from '@mindroom/client-sdk/room';

/** This page load; what the plugin stored in it does not count as seen before. */
const pageLoad = `${Date.now()}-${Math.random()}`;

const greetingText = (event: PluginEvent): string | undefined => {
  const greeting = event.content['com.example.greeting'];
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
  const text = greetingText(event);
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
      {seenIn !== null && seenIn !== pageLoad && <div data-example-plugin-seen>Seen before</div>}
      {panel && (
        <button type="button" onClick={() => panel.open(text)}>
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

function RoomBanner({ room }: { room: Room }) {
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
      <button type="button" onClick={() => void reloadForNewVersion()}>
        Reload into the new version
      </button>
    </div>
  );
}

function ExamplePanel({ roomId, request }: { roomId: string; request?: unknown }) {
  const members = useRoomMembers(useMatrixClient(), roomId);
  const joined = members.filter(({ membership }) => membership === KnownMembership.Join);
  return (
    <>
      <p>Example panel of {roomId}</p>
      <p>
        Members: {joined.length}, {hasActiveMindroomAgent(members) ? 'with' : 'without'} a MindRoom
        agent
      </p>
      {typeof request === 'string' && <p>Greeting: {request}</p>}
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
  messageRenderers: [{ match: (event) => greetingText(event) !== undefined, Component: Greeting }],
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
  sidePanels: [{ id: 'panel', label: 'Example panel', Component: ExamplePanel, remember: true }],
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
  ],
  translations: {
    en: {
      label: 'Example plugin',
      wave: 'Wave',
      greet: 'Send the room a greeting. Example: /greet Hello',
    },
    load: async (language) =>
      language === 'de' ? (await import('./locales/de.json')).default : undefined,
  },
};

export default plugin;
