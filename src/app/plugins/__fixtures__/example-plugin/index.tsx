// A client plugin for the tests (docs/architecture.md "Client plugins"): a message that carries
// `com.example.greeting: { text }` shows as "<label>: <text>", with `label` from its config.json
// section (`plugins.example.label`).
import type { ClientPlugin } from '../../registry';
import type { PluginEvent } from '../../messageRenderers';
import { usePluginConfig } from '../../pluginConfig';

const greetingText = (event: PluginEvent): string | undefined => {
  const greeting = event.content['com.example.greeting'];
  if (typeof greeting !== 'object' || greeting === null || !('text' in greeting)) return undefined;
  return typeof greeting.text === 'string' ? greeting.text : undefined;
};

function Greeting({ event }: { event: PluginEvent }) {
  const config = usePluginConfig('example');
  const label =
    typeof config === 'object' &&
    config !== null &&
    'label' in config &&
    typeof config.label === 'string'
      ? config.label
      : 'Example plugin';
  return (
    <div data-example-plugin>
      {label}: {greetingText(event)}
    </div>
  );
}

const plugin: ClientPlugin = {
  messageRenderers: [{ match: (event) => greetingText(event) !== undefined, Component: Greeting }],
};

export default plugin;
