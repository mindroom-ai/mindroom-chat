import { describe, expect, it } from 'vitest';
import { EventType, MatrixEvent } from 'matrix-js-sdk';
import { CALL_FAILURE_CONTENT_KEY, getCallFailureNotice } from './callFailureNotice';

const messageEvent = (content: Record<string, unknown>, type = EventType.RoomMessage) =>
  new MatrixEvent({
    event_id: '$event',
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@agent:example.org',
    type,
    content,
  });

describe('getCallFailureNotice', () => {
  it('returns marked call failure notices', () => {
    const event = messageEvent({
      msgtype: 'm.notice',
      body: 'Voice call error: update the provider credential and restart MindRoom.',
      [CALL_FAILURE_CONTENT_KEY]: { version: 1 },
    });

    expect(getCallFailureNotice(event)).toBe(
      'Voice call error: update the provider credential and restart MindRoom.'
    );
  });

  it('ignores ordinary room notices', () => {
    const event = messageEvent({ msgtype: 'm.notice', body: 'Ordinary agent notice.' });

    expect(getCallFailureNotice(event)).toBeUndefined();
  });

  it('ignores malformed marked events', () => {
    expect(
      getCallFailureNotice(
        messageEvent({
          msgtype: 'm.notice',
          body: '   ',
          [CALL_FAILURE_CONTENT_KEY]: { version: 1 },
        })
      )
    ).toBeUndefined();
    expect(
      getCallFailureNotice(
        messageEvent({
          msgtype: 'm.text',
          body: 'Not a notice.',
          [CALL_FAILURE_CONTENT_KEY]: { version: 1 },
        })
      )
    ).toBeUndefined();
  });
});
