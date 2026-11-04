import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { MatrixClientProvider } from '../hooks/useMatrixClient';
import { ClientConfigProvider } from '../hooks/useClientConfig';
import { RenderMessageContent } from './RenderMessageContent';

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_helper:example.org';
const PERSON = '@person:example.org';

// A finished agent reply whose edit carries only the Markdown body, as MindRoom sometimes sends.
const BODY = [
  '🔧 `run_shell_command` [1]',
  '',
  '**Summary**',
  '',
  '- first point',
  '- second point',
].join('\n');

const plainBodyContent = (): IContent => ({
  msgtype: 'm.text',
  body: BODY,
  'io.mindroom.stream_status': 'completed',
});

describe('RenderMessageContent with a plain body', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const render = (sender: string) => {
    const mEvent = new MatrixEvent({
      type: 'm.room.message',
      room_id: '!room:example.org',
      event_id: '$reply',
      sender,
      origin_server_ts: 1,
      content: plainBodyContent(),
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
              getContent={(() => plainBodyContent()) as never}
              urlPreview={false}
              htmlReactParserOptions={{}}
              linkifyOpts={{}}
            />
          </ClientConfigProvider>
        </MatrixClientProvider>
      );
    });
    return renderer!.root;
  };

  it("renders a MindRoom agent's Markdown body without formatted_body as Markdown", () => {
    const root = render(AGENT);

    expect(root.findAllByType('strong').map((node) => node.children.join(''))).toEqual(['Summary']);
    expect(root.findAllByType('li')).toHaveLength(2);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('**Summary**');
  });

  it("keeps a person's plain body as plain text", () => {
    const root = render(PERSON);

    expect(root.findAllByType('strong')).toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain('**Summary**');
  });
});
