// A client plugin for the tests (docs/architecture.md "Client plugins"): a message that carries
// `com.example.greeting: { text }` shows as "<label>: <text>", with `label` from its config.json
// section (`plugins.example.label`), else from its strings: English here, German in locales/de.json.
// A side panel, "Example panel", names the room it is open in.
// Under the room header it shows "Example banner in <room name>" and a button, "Show example
// cover", that covers the room's conversation with "Example cover of <room name>" until its Close
// button or Escape closes it. Like a plugin outside this repository, it imports the app only
// through the client SDK.
import type { Room } from 'matrix-js-sdk';
import {
  usePluginConfig,
  usePluginTranslation,
  type ClientPlugin,
  type PluginEvent,
} from '@mindroom/client-sdk/core';

const greetingText = (event: PluginEvent): string | undefined => {
  const greeting = event.content['com.example.greeting'];
  if (typeof greeting !== 'object' || greeting === null || !('text' in greeting)) return undefined;
  return typeof greeting.text === 'string' ? greeting.text : undefined;
};

function Greeting({ event }: { event: PluginEvent }) {
  const config = usePluginConfig('example');
  const t = usePluginTranslation('example');
  const label =
    typeof config === 'object' &&
    config !== null &&
    'label' in config &&
    typeof config.label === 'string'
      ? config.label
      : t('label');
  return (
    <div data-example-plugin>
      {label}: {greetingText(event)}
    </div>
  );
}

function RoomBanner({ room }: { room: Room }) {
  return (
    <div data-example-plugin-banner style={{ paddingBlock: 8, paddingInline: 16 }}>
      Example banner in {room.name}
    </div>
  );
}

function ExamplePanel({ roomId }: { roomId: string }) {
  return <p>Example panel of {roomId}</p>;
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
  roomHeaderSlot: [RoomBanner, CoverButton],
  sidePanels: [{ id: 'panel', label: 'Example panel', Component: ExamplePanel }],
  translations: {
    en: { label: 'Example plugin' },
    load: async (language) =>
      language === 'de' ? (await import('./locales/de.json')).default : undefined,
  },
};

export default plugin;
