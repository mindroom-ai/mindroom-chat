// A client plugin for the tests (docs/architecture.md "Client plugins"): a message that carries
// `com.example.greeting: { text }` shows as "<label>: <text>", with `label` from its config.json
// section (`plugins.example.label`). Its storage notes each greeting the signed-in account saw, when
// it shows and when it goes, and a greeting the account saw in an earlier page load also shows
// "Seen before".
import { useEffect } from 'react';
import type { ClientPlugin } from '../../registry';
import type { PluginEvent } from '../../messageRenderers';
import { usePluginConfig } from '../../pluginConfig';
import { usePluginStorage } from '../../pluginStorage';

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
  const label =
    typeof config === 'object' &&
    config !== null &&
    'label' in config &&
    typeof config.label === 'string'
      ? config.label
      : 'Example plugin';
  return (
    <>
      <div data-example-plugin>
        {label}: {greetingText(event)}
      </div>
      {seenIn !== null && seenIn !== pageLoad && <div data-example-plugin-seen>Seen before</div>}
    </>
  );
}

const plugin: ClientPlugin = {
  messageRenderers: [{ match: (event) => greetingText(event) !== undefined, Component: Greeting }],
  // It keeps nothing outside its storage, which the app deletes itself; for the tests, it notes the
  // account it was asked to forget in this tab.
  forgetAccount: (userId) => {
    sessionStorage.setItem('example-plugin.forgot', userId);
  },
};

export default plugin;
