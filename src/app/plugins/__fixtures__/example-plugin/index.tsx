// A client plugin for the tests (docs/architecture.md "Client plugins"): a message that carries
// `com.example.greeting: { text }` shows as "<label>: <text>", with `label` from its config.json
// section (`plugins.example.label`), else from its strings: English here, German in locales/de.json.
// A side panel, "Example panel", names the room it is open in.
// Under the room header it shows "Example banner in <room name>", after the mark it ships as a file
// (public/mark.svg). Like a plugin outside this repository, it imports the app only through the
// client SDK.
import type { Room } from 'matrix-js-sdk';
import {
  pluginPublicUrl,
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

function ExamplePanel({ roomId }: { roomId: string }) {
  return <p>Example panel of {roomId}</p>;
}

const plugin: ClientPlugin = {
  messageRenderers: [{ match: (event) => greetingText(event) !== undefined, Component: Greeting }],
  roomHeaderSlot: [RoomBanner],
  sidePanels: [{ id: 'panel', label: 'Example panel', Component: ExamplePanel }],
  translations: {
    en: { label: 'Example plugin' },
    load: async (language) =>
      language === 'de' ? (await import('./locales/de.json')).default : undefined,
  },
};

export default plugin;
