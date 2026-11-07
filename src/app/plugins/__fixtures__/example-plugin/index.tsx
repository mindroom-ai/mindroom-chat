// A client plugin for the tests (docs/architecture.md "Client plugins"): a message that carries
// `com.example.greeting: { text }` shows as "<label>: <text>", with `label` from its config.json
// section (`plugins.example.label`), else from its strings: English here, German in locales/de.json.
// A side panel, "Example panel", names the room it is open in.
// Under the room header it shows "Example banner in <room name>". Like a plugin outside this
// repository, it imports the app only through the client SDK.
// A header action, "Wave" ("Winken" in German), shows in the room header's row, except on phones,
// where it goes in the room menu, and says where it ran in an alert.
// Its storage notes each greeting the signed-in account saw, when it shows and when it goes, and a
// greeting the account saw in an earlier page load also shows "Seen before".
import { useEffect } from 'react';
import { Icons } from 'folds';
import type { Room } from 'matrix-js-sdk';
import {
  usePluginConfig,
  usePluginStorage,
  usePluginTranslation,
  type ClientPlugin,
  type PluginEvent,
} from '@mindroom/client-sdk/core';

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
        {label}: {greetingText(event)}
      </div>
      {seenIn !== null && seenIn !== pageLoad && <div data-example-plugin-seen>Seen before</div>}
    </>
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

const plugin: ClientPlugin = {
  messageRenderers: [{ match: (event) => greetingText(event) !== undefined, Component: Greeting }],
  // It keeps nothing outside its storage, which the app deletes itself; for the tests, it notes the
  // account it was asked to forget in this tab.
  forgetAccount: (userId) => {
    sessionStorage.setItem('example-plugin.forgot', userId);
  },
  roomHeaderSlot: [RoomBanner],
  sidePanels: [{ id: 'panel', label: 'Example panel', Component: ExamplePanel }],
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
  translations: {
    en: { label: 'Example plugin', wave: 'Wave' },
    load: async (language) =>
      language === 'de' ? (await import('./locales/de.json')).default : undefined,
  },
};

export default plugin;
