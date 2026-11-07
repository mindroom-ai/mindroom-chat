import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import type { PluginEvent } from '../../plugins/messageRenderers';
import { RenderMessageContent } from './RenderMessageContent';

const mocks = vi.hoisted(() => ({ reportBoundaryError: vi.fn(), chartRenders: vi.fn() }));
vi.mock('../../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError: mocks.reportBoundaryError,
}));

// Plugins as a build lists them: one renders greetings, one fails on what it matches, and one fails
// on a chart until the chart has its series, as a reply that streams in does.
vi.mock('../../plugins/pluginEntries', () => {
  const greeting = ({ event }: { event: PluginEvent }) =>
    `plugin:${String(event.content['com.example.greeting'])} from ${event.sender} in ${String(
      event.roomId
    )} (${String(event.eventId)}, ${String(event.type)})`;
  return {
    pluginEntries: [
      {
        id: 'example',
        version: '1.0.0',
        plugin: {
          messageRenderers: [
            {
              match: (event: PluginEvent) =>
                typeof event.content['com.example.greeting'] === 'string',
              Component: greeting,
            },
          ],
        },
      },
      {
        id: 'broken',
        version: '0.1.0',
        plugin: {
          messageRenderers: [
            {
              match: (event: PluginEvent) => event.content.explode === true,
              Component: () => {
                throw new Error('boom');
              },
            },
            {
              // Throws something that is not an Error.
              match: (event: PluginEvent) => event.content.explode === 'string',
              Component: () => {
                // eslint-disable-next-line @typescript-eslint/no-throw-literal
                throw 'not an error';
              },
            },
            {
              // Throws a value with no text form at all.
              match: (event: PluginEvent) => event.content.explode === 'opaque',
              Component: () => {
                throw Object.create(null);
              },
            },
          ],
        },
      },
      {
        id: 'chart',
        version: '2.0.0',
        plugin: {
          messageRenderers: [
            {
              match: (event: PluginEvent) => typeof event.content['com.example.chart'] === 'object',
              Component: ({ event }: { event: PluginEvent }) => {
                mocks.chartRenders();
                const { series } = event.content['com.example.chart'] as { series?: string };
                if (!series) throw new Error('no series yet');
                return `chart:${series}`;
              },
            },
          ],
        },
      },
    ],
  };
});

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
const PERSON = '@person:example.org';

const text = (fields: IContent): IContent => ({
  msgtype: 'm.text',
  body: 'Fallback body',
  ...fields,
});

describe('RenderMessageContent with client plugins', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.restoreAllMocks();
    mocks.reportBoundaryError.mockReset();
  });

  /** The message's body: `content` is what the app shows, `original` the event's own. */
  const message = (
    sender: string,
    content: IContent,
    { config = {}, original = content }: { config?: ClientConfig; original?: IContent } = {}
  ) => {
    const mEvent = new MatrixEvent({
      type: 'm.room.message',
      room_id: '!room:example.org',
      event_id: '$message',
      sender,
      origin_server_ts: 1,
      content: original,
    });
    const mx = { getUserId: () => VIEWER } as unknown as MatrixClient;
    return (
      <MatrixClientProvider value={mx}>
        <ClientConfigProvider value={config}>
          <RenderMessageContent
            mEvent={mEvent}
            displayName="Sender"
            msgType="m.text"
            eventType="m.room.message"
            ts={1}
            getContent={(() => content) as never}
            urlPreview={false}
            htmlReactParserOptions={{}}
            linkifyOpts={{}}
          />
        </ClientConfigProvider>
      </MatrixClientProvider>
    );
  };

  /** What the message renders as. */
  const render = (...args: Parameters<typeof message>): string => {
    act(() => {
      renderer = create(message(...args));
    });
    return JSON.stringify(renderer!.toJSON());
  };

  /** What the same rendered message shows once its props change, as when it is edited. */
  const update = (...args: Parameters<typeof message>): string => {
    act(() => renderer!.update(message(...args)));
    return JSON.stringify(renderer!.toJSON());
  };

  it("renders an agent's message through the plugin that matches it", () => {
    const shown = render(AGENT, text({ 'com.example.greeting': 'Hello' }));
    expect(shown).toContain(
      `plugin:Hello from ${AGENT} in !room:example.org ($message, m.room.message)`
    );
    expect(shown).not.toContain('Fallback body');
  });

  it('gives the plugin the content the app shows, such as the latest edit', () => {
    const shown = render(AGENT, text({ 'com.example.greeting': 'Edited' }), {
      original: text({ 'com.example.greeting': 'Original' }),
    });
    expect(shown).toContain('plugin:Edited');
    expect(shown).not.toContain('Original');
  });

  it("renders a person's message with the same content as core does", () => {
    const shown = render(PERSON, text({ 'com.example.greeting': 'Hello' }));
    expect(shown).toContain('Fallback body');
    expect(shown).not.toContain('plugin:');
  });

  it('renders core when config.json turns the plugin off', () => {
    const config = { plugins: { example: { enabled: false } } } as unknown as ClientConfig;
    const shown = render(AGENT, text({ 'com.example.greeting': 'Hello' }), { config });
    expect(shown).toContain('Fallback body');
    expect(shown).not.toContain('plugin:');
  });

  it("falls back to core when the plugin fails, and reports the failure under the plugin's tag", () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const shown = render(AGENT, text({ explode: true }));
    expect(shown).toContain('Fallback body');
    expect(mocks.reportBoundaryError).toHaveBeenCalledTimes(1);
    expect(mocks.reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Error', message: '[plugin broken@0.1.0] boom' }),
      expect.any(String)
    );
    expect(
      logged.mock.calls.some(([first]) => String(first).includes('[plugin broken@0.1.0]'))
    ).toBe(true);
  });

  it('lets another plugin render a message an earlier plugin failed on, once it takes the message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(render(AGENT, text({ explode: true }))).toContain('Fallback body');
    // An edit that the failed plugin no longer matches and another plugin does.
    const shown = update(AGENT, text({ 'com.example.greeting': 'Edited' }));
    expect(shown).toContain('plugin:Edited');
  });

  it.each([
    ['something not an Error', 'string', 'not an error'],
    ['a value with no text form', 'opaque', 'a value that cannot be shown as text'],
  ])(
    'falls back to core and reports under the tag when a plugin throws %s',
    (_, explode, message) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(render(AGENT, text({ explode }))).toContain('Fallback body');
      expect(mocks.reportBoundaryError).toHaveBeenCalledWith(
        expect.objectContaining({ message: `[plugin broken@0.1.0] ${message}` }),
        expect.any(String)
      );
    }
  );

  it('tries a plugin that failed on a message again once the message changes, as it streams in', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(render(AGENT, text({ 'com.example.chart': {} }))).toContain('Fallback body');
    expect(update(AGENT, text({ 'com.example.chart': { series: '1,2' } }))).toContain('chart:1,2');
  });

  it('does not try a failed plugin again while the message stays the same', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(AGENT, text({ 'com.example.chart': {} }));
    const tries = mocks.chartRenders.mock.calls.length;
    // Drawn again with new objects of the same content, as the timeline draws an edited message.
    expect(update(AGENT, text({ 'com.example.chart': {} }))).toContain('Fallback body');
    expect(mocks.chartRenders.mock.calls.length).toBe(tries);
  });

  it('lets another plugin render the same message once a refreshed config.json hands it over', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const both = text({ explode: true, 'com.example.greeting': 'Hello' });
    const exampleOff = { plugins: { example: { enabled: false } } } as unknown as ClientConfig;
    expect(render(AGENT, both, { config: exampleOff })).toContain('Fallback body');
    expect(update(AGENT, both, { config: {} })).toContain('plugin:Hello');
  });
});
