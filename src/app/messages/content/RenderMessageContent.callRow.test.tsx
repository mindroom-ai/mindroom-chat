// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { getLatestMessageContent } from '../../matrix/room';
import type { CallRowContent } from '../../matrix/protocol/callRow';
import { RenderMessageContent } from './RenderMessageContent';

vi.mock('../../calls/transcription/CallRow', () => ({
  CallRow: ({ mEvent, row }: { mEvent: MatrixEvent; row: CallRowContent }) => (
    <div data-call-row-stub={mEvent.getId()}>{JSON.stringify(row)}</div>
  ),
}));

const VIEWER = '@reader:example.org';
const ROUTER = '@mindroom_router:example.org';
const PERSON = '@person:example.org';
const ROOM_ID = '!room:example.org';

const ROW: IContent = {
  msgtype: 'm.notice',
  body: 'Call started',
  'io.mindroom.call': { call_id: 'call-1' },
};

const ENDED: IContent = {
  msgtype: 'm.notice',
  body: 'Call ended · 12 min',
  'io.mindroom.call': {
    call_id: 'call-1',
    ended_at: '2026-11-07T10:00:00Z',
    duration_seconds: 720,
  },
};

const message = (eventId: string, sender: string, content: IContent) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: ROOM_ID,
    event_id: eventId,
    sender,
    origin_server_ts: 1,
    content,
  });

/** An edit of the row, as the router (or someone else) sends it. */
const edit = (sender: string, newContent: IContent) =>
  message('$edit', sender, {
    ...newContent,
    body: `* ${String(newContent.body)}`,
    'm.new_content': newContent,
    'm.relates_to': { rel_type: 'm.replace', event_id: '$row' },
  });

describe("a call's row", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** Renders the row with the content the timeline shows for it: its latest edit's. */
  const render = async (sender: string, rowEdit?: MatrixEvent) => {
    const mEvent = message('$row', sender, ROW);
    const content = getLatestMessageContent(mEvent, rowEdit);
    const mx = {
      getUserId: () => VIEWER,
      getRoom: () => null,
      on: () => undefined,
      removeListener: () => undefined,
    } as unknown as MatrixClient;
    await act(async () =>
      root.render(
        <MatrixClientProvider value={mx}>
          <ClientConfigProvider value={{}}>
            <RenderMessageContent
              mEvent={mEvent}
              roomId={ROOM_ID}
              displayName="Router"
              msgType="m.notice"
              ts={1}
              getContent={(() => content) as never}
              urlPreview={false}
              htmlReactParserOptions={{}}
              linkifyOpts={{}}
            />
          </ClientConfigProvider>
        </MatrixClientProvider>
      )
    );
  };

  const shown = () => {
    const stub = container.querySelector('[data-call-row-stub]');
    return stub ? (JSON.parse(stub.textContent ?? '') as CallRowContent) : undefined;
  };

  it("shows a MindRoom agent's unedited row as the live call", async () => {
    await render(ROUTER);
    expect(shown()).toEqual({ callId: 'call-1' });
  });

  it("shows the row from the router's latest edit", async () => {
    await render(ROUTER, edit(ROUTER, ENDED));
    expect(shown()).toEqual({ callId: 'call-1', ended: { durationSeconds: 720 } });
  });

  it('ignores an edit not from the MindRoom agent that posted the row', async () => {
    await render(ROUTER, edit(PERSON, ENDED));
    expect(shown()).toEqual({ callId: 'call-1' });
  });

  it("shows a person's lookalike as the notice it is", async () => {
    await render(PERSON);
    expect(container.querySelector('[data-call-row-stub]')).toBeNull();
    expect(container.textContent).toContain('Call started');
  });
});
