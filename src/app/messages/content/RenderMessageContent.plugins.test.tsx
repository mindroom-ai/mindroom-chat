import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider, type ClientConfig } from '../../config/useClientConfig';
import { RenderMessageContent } from './RenderMessageContent';

const mocks = vi.hoisted(() => ({ reportBoundaryError: vi.fn() }));
vi.mock('../../bug-reports/error-reporting/errorReporting', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportBoundaryError: mocks.reportBoundaryError,
}));

// Two plugins as a build lists them: one renders greetings, the other fails on what it matches.
vi.mock('../../plugins/pluginEntries', () => {
  type Shown = { event: { content: Record<string, unknown> } & Record<string, unknown> };
  const greeting = ({ event }: Shown) =>
    `plugin:${String(event.content['com.example.greeting'])} from ${String(
      event.sender
    )} in ${String(event.roomId)} (${String(event.eventId)}, ${String(event.type)})`;
  return {
    pluginEntries: [
      {
        id: 'example',
        version: '1.0.0',
        plugin: {
          messageRenderers: [
            {
              match: (event: Shown['event']) =>
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
              match: (event: Shown['event']) => event.content.explode === true,
              Component: () => {
                throw new Error('boom');
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

  /** What the message renders as: `content` is what the app shows, `original` the event's own. */
  const render = (
    sender: string,
    content: IContent,
    { config = {}, original = content }: { config?: ClientConfig; original?: IContent } = {}
  ): string => {
    const mEvent = new MatrixEvent({
      type: 'm.room.message',
      room_id: '!room:example.org',
      event_id: '$message',
      sender,
      origin_server_ts: 1,
      content: original,
    });
    const mx = { getUserId: () => VIEWER } as unknown as MatrixClient;
    act(() => {
      renderer = create(
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
    });
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
});
