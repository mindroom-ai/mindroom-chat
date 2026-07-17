import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { getEditedEvent } from '../../utils/room';
import {
  buildMindroomRoomTimelineReplyDraft,
  resolveMindroomReplyDraftEventIds,
} from './roomTimelineReplyDraft';

vi.mock('../../utils/room', () => ({
  getEditedEvent: vi.fn(),
}));

const event = ({
  content,
  sender = '@sender:server',
  threadRootId,
  wireContent = {},
}: {
  content: Record<string, unknown>;
  sender?: string | undefined;
  threadRootId?: string;
  wireContent?: Record<string, unknown>;
}) =>
  ({
    getContent: () => content,
    getSender: () => sender,
    getWireContent: () => wireContent,
    threadRootId,
  } as unknown as MatrixEvent);

const roomWithEvent = (replyEvent: MatrixEvent | undefined) =>
  ({
    findEventById: vi.fn(() => replyEvent),
    getUnfilteredTimelineSet: vi.fn(() => ({})),
  } as unknown as Room);

describe('buildMindroomRoomTimelineReplyDraft', () => {
  beforeEach(() => {
    vi.mocked(getEditedEvent).mockReset();
    vi.mocked(getEditedEvent).mockReturnValue(undefined);
  });

  it('builds a reply draft from the original message content', () => {
    const relation = { event_id: '$root', rel_type: 'm.thread' };
    const replyEvent = event({
      content: { body: 'hello', formatted_body: '<b>hello</b>' },
      wireContent: { 'm.relates_to': relation },
    });

    expect(buildMindroomRoomTimelineReplyDraft(roomWithEvent(replyEvent), '$reply', false)).toEqual(
      {
        draft: {
          userId: '@sender:server',
          eventId: '$reply',
          body: 'hello',
          formattedBody: '<b>hello</b>',
          relation,
        },
        threadRootId: '$reply',
      }
    );
  });

  it('uses edited message content when an edit exists', () => {
    const replyEvent = event({ content: { body: 'old' } });
    vi.mocked(getEditedEvent).mockReturnValue(
      event({
        content: {
          'm.new_content': {
            body: 'edited',
            formatted_body: '<strong>edited</strong>',
          },
        },
      })
    );

    expect(
      buildMindroomRoomTimelineReplyDraft(roomWithEvent(replyEvent), '$reply', false)?.draft
    ).toMatchObject({
      body: 'edited',
      formattedBody: '<strong>edited</strong>',
    });
  });

  it('builds the thread relation when starting a thread from a normal message', () => {
    const replyEvent = event({ content: { body: 'root' } });

    expect(buildMindroomRoomTimelineReplyDraft(roomWithEvent(replyEvent), '$root', true)).toEqual({
      draft: {
        userId: '@sender:server',
        eventId: '$root',
        body: 'root',
        formattedBody: undefined,
        relation: {
          event_id: '$root',
          rel_type: 'm.thread',
        },
      },
      threadRootId: '$root',
    });
  });

  it('does not create a draft for missing events or non-text bodies', () => {
    expect(buildMindroomRoomTimelineReplyDraft(roomWithEvent(undefined), '$missing', false)).toBe(
      undefined
    );
    expect(
      buildMindroomRoomTimelineReplyDraft(
        roomWithEvent(event({ content: { body: { object: true } } })),
        '$reply',
        false
      )
    ).toBe(undefined);
  });

  it('canonicalizes every local target retained by a reply draft', () => {
    const roomId = '!room:example.org';
    const confirmedEvent = (eventId: string, txnId: string): MatrixEvent =>
      ({
        getId: () => eventId,
        getTxnId: () => txnId,
        getUnsigned: () => ({ transaction_id: txnId }),
      } as unknown as MatrixEvent);
    const confirmedByTxn = new Map([
      ['reply-txn', confirmedEvent('$reply', 'reply-txn')],
      ['root-txn', confirmedEvent('$root', 'root-txn')],
      ['fallback-txn', confirmedEvent('$fallback', 'fallback-txn')],
    ]);
    const room = {
      roomId,
      getEventForTxnId: (txnId: string) => confirmedByTxn.get(txnId),
      getLiveTimeline: () => ({
        getEvents: () => Array.from(confirmedByTxn.values()),
      }),
    } as unknown as Room;

    expect(
      resolveMindroomReplyDraftEventIds(room, {
        userId: '@sender:server',
        eventId: `~${roomId}:reply-txn`,
        body: 'reply',
        relation: {
          rel_type: 'm.thread',
          event_id: `~${roomId}:root-txn`,
          'm.in_reply_to': {
            event_id: `~${roomId}:fallback-txn`,
          },
        },
      })
    ).toEqual({
      userId: '@sender:server',
      eventId: '$reply',
      body: 'reply',
      relation: {
        rel_type: 'm.thread',
        event_id: '$root',
        'm.in_reply_to': {
          event_id: '$fallback',
        },
      },
    });
  });
});
