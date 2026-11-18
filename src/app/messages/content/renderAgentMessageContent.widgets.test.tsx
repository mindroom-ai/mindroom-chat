// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ClientEvent, MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { trustAgentsOfViewer } from '../../matrix/protocol/untrustedContent';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from '../html/react-custom-html-parser';
import { renderAgentMessageContent } from './renderAgentMessageContent';
import { bindLiveReplyFrames } from '../live/bindLiveReplyFrames';
import { loadLiveMarkdown } from '../live/liveMarkdown';
import { LiveReplyMessageContent } from '../../timeline/message-rendering/LiveReplyMessageContent';
import fixture from '../widgets/__fixtures__/ui-widgets-v1.json';

const VIEWER = '@viewer:example.org';
const AGENT = '@mindroom_atlas:example.org';
const TABLE = 'Signups (line chart, users)';

type RenderCase = { name: string; stage: number; text: string; html: string; ui: unknown };
const renders = fixture.renders as RenderCase[];
const spec54 = renders.find((c) => c.name === "the spec's finished reply");
const form = renders.find((c) => c.stage === 2);
if (!spec54 || !form) throw new Error('The fixture lacks the 5.4 reply or the Stage 2 form');

const contentOf = (c: RenderCase, ui: unknown = c.ui): Record<string, unknown> => ({
  msgtype: 'm.text',
  body: c.text,
  format: 'org.matrix.custom.html',
  formatted_body: c.html,
  'io.mindroom.stream_status': 'completed',
  ...(ui != null && { 'io.mindroom.ui': ui }),
});

const eventOf = (sender: string, content: Record<string, unknown>, redacted = false) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: '!room:example.org',
    event_id: '$reply',
    sender,
    origin_server_ts: 1,
    content,
    ...(redacted && { unsigned: { redacted_because: { type: 'm.room.redaction' } as never } }),
  });

let renderer: ReactTestRenderer | undefined;

beforeAll(async () => {
  // The widget chunk, loaded once so the slot's lazy part resolves at once.
  await import('../widgets/UiWidget');
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const render = async ({
  sender = AGENT,
  content = contentOf(spec54),
  viewer = VIEWER as string | null,
  fromMindroomAgent = true,
  redacted = false,
} = {}) => {
  const mx = { getUserId: () => viewer } as unknown as MatrixClient;
  const mEvent = eventOf(sender, content, redacted);
  await act(async () => {
    renderer = create(
      <MatrixClientProvider value={mx}>
        <ClientConfigProvider value={{}}>
          {renderAgentMessageContent({
            mEvent,
            fromMindroomAgent,
            displayName: 'Atlas',
            msgType: 'm.text',
            content,
            htmlReactParserOptions: getReactCustomHtmlParser(mx, '!room:example.org', {
              linkifyOpts: LINKIFY_OPTS,
            }),
            linkifyOpts: LINKIFY_OPTS,
          })}
        </ClientConfigProvider>
      </MatrixClientProvider>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return renderer!.root;
};

const pres = () => renderer!.root.findAllByType('pre');
const figures = () => renderer!.root.findAllByType('figure');
const text = () => JSON.stringify(renderer!.toJSON());

describe('widgets in an agent reply', () => {
  it("draws a viewer's agent's chart in place of its fallback block", async () => {
    await render();

    expect(figures()).toHaveLength(1);
    expect(text()).toContain('Signups');
    expect(text()).not.toContain(TABLE);
    expect(pres()).toHaveLength(0);
  });

  it.each([
    ['a person', '@alice:example.org'],
    ["an agent of another homeserver's viewer", '@mindroom_atlas:other.org'],
  ])(
    'keeps the fallback block for %s, though the caller calls it an agent',
    async (_name, sender) => {
      trustAgentsOfViewer('@second:other.org');
      await render({ sender });

      expect(figures()).toHaveLength(0);
      expect(pres()).toHaveLength(1);
      expect(text()).toContain(TABLE);
    }
  );

  it('keeps the fallback block without a signed-in viewer', async () => {
    await render({ viewer: null });

    expect(figures()).toHaveLength(0);
    expect(text()).toContain(TABLE);
  });

  it('keeps the fallback block of a redacted reply', async () => {
    await render({ redacted: true });

    expect(figures()).toHaveLength(0);
  });

  it('shows the block as plain text when the value lacks its id', async () => {
    const ui = { version: 1, widgets: [{ id: 'aaaaaaaaaa', json: '{"type":"chart"}' }] };
    await render({ content: contentOf(spec54, ui) });

    expect(figures()).toHaveLength(0);
    expect(text()).toContain(TABLE);
    expect(text()).not.toContain('mindroom-ui-');
  });

  it('shows the fallback text of an entry this build cannot draw', async () => {
    await render({ content: contentOf(form) });
    expect(figures()).toHaveLength(0);
    expect(pres()).toHaveLength(1);

    const [entry] = (spec54.ui as { widgets: { id: string }[] }).widgets;
    const map = { version: 1, widgets: [{ id: entry!.id, json: '{"type":"map"}' }] };
    await render({ content: contentOf(spec54, map) });
    expect(figures()).toHaveLength(0);
    expect(text()).toContain(TABLE);
  });
});

describe('widgets from live frames', () => {
  const ROOM = '!room:example.org';
  const OTHER_ROOM = '!other:example.org';
  const SID = '1761858000123-0a1b2c3d';

  const liveClient = () => {
    const mx = Object.assign(new EventEmitter(), {
      getUserId: () => VIEWER,
      getRoom: (roomId: string) =>
        [ROOM, OTHER_ROOM].includes(roomId) ? { hasEncryptionStateEvent: () => false } : null,
    }) as unknown as MatrixClient;
    const unbind = bindLiveReplyFrames(mx);
    const receive = (frame: unknown, { sender = AGENT, roomId = ROOM } = {}) =>
      act(async () => {
        mx.emit(
          ClientEvent.Event,
          new MatrixEvent({
            type: 'io.mindroom.live',
            content: frame as Record<string, unknown>,
            sender,
            room_id: roomId,
            origin_server_ts: 1,
          })
        );
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      });
    return { mx, unbind, receive };
  };

  const snapshot = (seq: number) => ({
    v: 1,
    reply: '$reply',
    sid: SID,
    seq,
    snapshot: {
      md: spec54.text,
      reasoning: '',
      tools: [],
      status: 'streaming',
      activity: '',
      ui: spec54.ui,
    },
  });
  const durable = { msgtype: 'm.text', body: 'Starting', 'io.mindroom.stream_status': 'streaming' };

  let unbindFrames: (() => void) | undefined;

  beforeAll(async () => {
    await loadLiveMarkdown();
  });

  afterEach(() => {
    unbindFrames?.();
    unbindFrames = undefined;
  });

  const renderLive = async (mx: MatrixClient) => {
    const mEvent = eventOf(AGENT, durable);
    await act(async () => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ClientConfigProvider value={{}}>
            <LiveReplyMessageContent
              mEvent={mEvent}
              displayName="Atlas"
              msgType="m.text"
              ts={1}
              getContent={(() => durable) as never}
              urlPreview={false}
              htmlReactParserOptions={getReactCustomHtmlParser(mx, ROOM, {
                linkifyOpts: LINKIFY_OPTS,
              })}
              linkifyOpts={LINKIFY_OPTS}
            />
          </ClientConfigProvider>
        </MatrixClientProvider>
      );
    });
  };

  it("draws the reply sender's frame widgets before any durable edit, and clears them", async () => {
    const { mx, unbind, receive } = liveClient();
    unbindFrames = unbind;
    await renderLive(mx);

    await receive(snapshot(0));
    expect(figures()).toHaveLength(1);
    expect(text()).not.toContain(TABLE);

    await receive({ v: 1, reply: '$reply', sid: SID, seq: 1, delta: { ui: null } });
    expect(figures()).toHaveLength(0);
    expect(text()).toContain(TABLE);
  });

  it("adds no widget from another agent's frame or a frame of another room", async () => {
    const { mx, unbind, receive } = liveClient();
    unbindFrames = unbind;
    await renderLive(mx);

    await receive(snapshot(0), { sender: '@mindroom_other:example.org' });
    await receive(snapshot(0), { roomId: OTHER_ROOM });
    expect(figures()).toHaveLength(0);
    expect(text()).not.toContain(TABLE);
  });
});
