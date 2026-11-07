// A client plugin for the tests (docs/architecture.md "Client plugins"): a message that carries
// `com.example.greeting: { text }` shows as "<label>: <text>", with `label` from its config.json
// section (`plugins.example.label`). Its page at /p/example/ keeps the app's rail and links to its
// page at /p/example/window, which fills the window and links back.
import type { ClientPlugin } from '../../registry';
import type { PluginEvent } from '../../messageRenderers';
import { usePluginConfig } from '../../pluginConfig';
import { usePluginRouteHref } from '../../pluginPages';

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

const plugin: ClientPlugin = {
  messageRenderers: [{ match: (event) => greetingText(event) !== undefined, Component: Greeting }],
  pages: [
    { path: '', Component: ExamplePage },
    { path: 'window', Component: WindowPage, fillsWindow: true },
  ],
};

export default plugin;
