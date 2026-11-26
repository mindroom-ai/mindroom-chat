// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  EventType,
  MsgType,
  RelationType,
  type IEventWithRoomId,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../config/useClientConfig';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { SearchResultBody } from './SearchResultBody';

vi.mock('./SearchResultBody.css', () => ({ SearchMatch: 'search-match' }));
vi.mock('../matrix/hooks/useMediaAuthentication', () => ({ useMediaAuthentication: () => false }));
vi.mock('../messages/useMentionClickHandler', () => ({
  useMentionClickHandler: () => vi.fn(),
}));

const VIEWER = '@reader:example.org';
const AGENT = '@mindroom_dev:example.org';
const ROOM_ID = '!room:example.org';

describe('SearchResultBody', () => {
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

  it('keeps fallback error text intact without RunErrorCard or Retry on m.replace search hits with no highlights', () => {
    const fallbackErrorText =
      "⏱️ Rate limit reached — Neon hit OpenRouter's rate limit after automatic retries.";
    const event: IEventWithRoomId = {
      type: EventType.RoomMessage,
      room_id: ROOM_ID,
      event_id: '$edit-hit',
      sender: AGENT,
      origin_server_ts: 2000,
      unsigned: {},
      content: {
        msgtype: MsgType.Text,
        body: `* ${fallbackErrorText}`,
        'm.relates_to': {
          rel_type: RelationType.Replace,
          event_id: '$original-reply',
        },
        'm.new_content': {
          msgtype: MsgType.Text,
          body: `**[Response interrupted by service restart]**\n\n${fallbackErrorText}`,
          format: 'org.matrix.custom.html',
          formatted_body:
            '<p><strong>[Response interrupted by service restart]</strong></p>' +
            `<p>${fallbackErrorText}</p>`,
          'io.mindroom.stream_status': 'error',
          'io.mindroom.ai_run': {
            version: 1,
            status: 'error',
            error: {
              kind: 'rate_limited',
              title: 'Rate limit reached',
              summary: "Neon hit OpenRouter's rate limit after automatic retries.",
              status_code: 429,
              provider: 'OpenRouter',
              retryable: true,
              action: 'retry',
            },
          },
        },
      },
    };

    const room = {
      roomId: ROOM_ID,
      getMyMembership: () => 'join',
      currentState: { maySendEvent: () => true },
      getMember: () => ({ name: 'DevAgent', rawDisplayName: 'DevAgent' }),
      getThread: () => undefined,
      getLiveTimeline: () => ({ getEvents: () => [] }),
    } as unknown as Room;
    const mx = {
      getUserId: () => VIEWER,
      getRoom: (id: string) => (id === ROOM_ID ? room : null),
      makeTxnId: () => 'txn-1',
      sendMessage: vi.fn(),
    } as unknown as MatrixClient;

    act(() => {
      root.render(
        <ClientConfigProvider value={{}}>
          <MatrixClientProvider value={mx}>
            <SearchResultBody
              room={room}
              item={{
                event,
                context: { events_before: [], events_after: [], profile_info: {} },
                rank: 1,
              }}
              highlights={[]}
              highlightRegex={undefined}
            />
          </MatrixClientProvider>
        </ClientConfigProvider>
      );
    });

    expect(container.querySelector('[data-run-error-card]')).toBeNull();
    expect(container.querySelector('[data-restart-seam]')).toBeNull();
    expect(
      [...container.querySelectorAll('button')].some((btn) => btn.textContent?.includes('Retry'))
    ).toBe(false);
    expect(container.textContent).toContain('[Response interrupted by service restart]');
    expect(container.textContent).toContain(fallbackErrorText);
  });
});
