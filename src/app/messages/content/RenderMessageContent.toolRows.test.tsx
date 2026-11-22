import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import {
  installEventContentGuard,
  trustAgentsOfViewer,
} from '../../matrix/protocol/untrustedContent';
import { RenderMessageContent } from './RenderMessageContent';

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
// An agent of another homeserver: anyone can register that name on a server of their own.
const ELSEWHERE = '@mindroom_helper:elsewhere.org';
const PERSON = '@person:example.org';

const TRACE = 'io.mindroom.tool_trace';
const CALL = { type: 'tool_call_completed', tool_name: 'shell', args_preview: 'cmd=ls' };
// A reply of one tool call alone, as Matrix holds it and as it was before its marker left its text.
const HELD = {
  msgtype: 'm.text',
  body: '',
  format: 'org.matrix.custom.html',
  formatted_body: '',
  [TRACE]: { version: 3, events: [{ ...CALL, body_line: 0, at: 0 }] },
};
const TYPED = {
  ...HELD,
  body: '🔧 `shell` [1]',
  formatted_body: '<p>🔧 <code>shell</code> [1]</p>\n',
  [TRACE]: { version: 2, events: [CALL] },
};

describe('RenderMessageContent with tool markers', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeAll(() => {
    installEventContentGuard();
    trustAgentsOfViewer(VIEWER);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  /**
   * The message as this viewer sees it: its text, and whether a tool row can be opened. Without a
   * sender it is content the app made, with no event.
   */
  const render = (sender: string | undefined, content: Record<string, unknown>) => {
    const mEvent =
      sender === undefined
        ? undefined
        : new MatrixEvent({
            type: 'm.room.message',
            room_id: '!room:example.org',
            event_id: '$reply',
            sender,
            origin_server_ts: 1,
            content,
          });
    const mx = { getUserId: () => VIEWER } as unknown as MatrixClient;
    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ClientConfigProvider value={{}}>
            <RenderMessageContent
              mEvent={mEvent}
              displayName="Helper"
              msgType="m.text"
              ts={1}
              getContent={(() => mEvent?.getContent() ?? content) as never}
              urlPreview={false}
              htmlReactParserOptions={{}}
              linkifyOpts={{}}
            />
          </ClientConfigProvider>
        </MatrixClientProvider>
      );
    });
    const text = JSON.stringify(renderer!.toJSON());
    return {
      marker: text.includes('🔧') && text.includes('shell'),
      rows: renderer!.root.findAllByType('button').length,
      trace: TRACE in (mEvent?.getContent() ?? content),
    };
  };

  it("draws the tool row of an agent on the viewer's homeserver", () => {
    for (const content of [HELD, TYPED]) {
      expect(render(AGENT, content)).toEqual({ marker: false, rows: 1, trace: true });
    }
  });

  it('shows the marker of an agent on another homeserver as text, with no row to open', () => {
    for (const content of [HELD, TYPED]) {
      expect(render(ELSEWHERE, content)).toEqual({ marker: true, rows: 0, trace: false });
    }
  });

  it("draws the tool row of content the app made itself, as a sub-agent's run is", () => {
    expect(render(undefined, TYPED)).toEqual({ marker: false, rows: 1, trace: true });
  });

  it("shows a marker a person typed as text, and none for a person's forged positions", () => {
    expect(render(PERSON, TYPED)).toEqual({ marker: true, rows: 0, trace: false });
    expect(render(PERSON, HELD)).toEqual({ marker: false, rows: 0, trace: false });
  });
});
