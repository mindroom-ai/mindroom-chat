// A client plugin for the tests (docs/architecture.md "Client plugins"): a message that carries
// `com.example.greeting: { text }` shows as "<label>: <text>", with `label` from its config.json
// section (`plugins.example.label`), else from its strings: English here, German in locales/de.json.
// A side panel, "Example panel", names the room it is open in.
import type { ClientPlugin } from '../../registry';
import type { PluginEvent } from '../../messageRenderers';
import { usePluginConfig } from '../../pluginConfig';
import { usePluginTranslation } from '../../pluginTranslations';

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

function ExamplePanel({ roomId }: { roomId: string }) {
  return <p>Example panel of {roomId}</p>;
}

const plugin: ClientPlugin = {
  messageRenderers: [{ match: (event) => greetingText(event) !== undefined, Component: Greeting }],
  sidePanels: [{ id: 'panel', label: 'Example panel', Component: ExamplePanel }],
  translations: {
    en: { label: 'Example plugin' },
    load: async (language) =>
      language === 'de' ? (await import('./locales/de.json')).default : undefined,
  },
};

export default plugin;
