import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import { describe, expect, it } from 'vitest';
import { resolveThreadPresentationSnapshot } from './threadPresentation';

// MindRoom titles a thread with an m.notice that carries `io.mindroom.thread_summary`. It is the
// thread's newest event once the agent titles it after replying, and a device that knows only that
// event (a fresh sign-in, before the thread's page loads) must not show the title as the card's
// reply preview: the card's title line already says it, and the reply line would repeat it.

const ROOT = '$root';

const root = new MatrixEvent({
  content: { body: 'Which checks still block the launch?', msgtype: 'm.text' },
  event_id: ROOT,
  origin_server_ts: 1,
  room_id: '!room:example.org',
  sender: '@reader:example.org',
  type: 'm.room.message',
});

const threadEvent = (eventId: string, ts: number, content: Record<string, unknown>) =>
  ({
    getContent: () => ({
      ...content,
      'm.relates_to': { event_id: ROOT, rel_type: RelationType.Thread },
    }),
    getId: () => eventId,
    getRelation: () => ({ event_id: ROOT, rel_type: RelationType.Thread }),
    getSender: () => '@mindroom_helper:example.org',
    getTs: () => ts,
    getType: () => 'm.room.message',
    isRedacted: () => false,
    isRedaction: () => false,
    threadRootId: ROOT,
  } as unknown as MatrixEvent);

const reply = threadEvent('$reply', 2, {
  msgtype: 'm.text',
  body: 'The load test passed; only the security review is still open.',
});

const titleNotice = (marker: unknown) =>
  threadEvent('$title', 3, {
    msgtype: 'm.notice',
    body: 'Launch checklist status',
    'io.mindroom.thread_summary': marker,
  });

const room = {
  getMember: () => undefined,
  getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
} as unknown as Room;

const present = (events: MatrixEvent[]) =>
  resolveThreadPresentationSnapshot({
    room,
    threadRootId: ROOT,
    thread: { events, timeline: events },
    rootEvent: root,
  });

describe('a thread title notice as the reply preview', () => {
  it.each([
    ['a versioned marker', { version: 1, summary: 'Launch checklist status' }],
    ['the legacy boolean marker', true],
  ])('is never the preview when it is the only loaded thread event (%s)', (_, marker) => {
    const presentation = present([titleNotice(marker)]);

    expect(presentation.latestReplyPreviewText).toBeUndefined();
    expect(presentation.rootPreviewText).toBe('Which checks still block the launch?');
  });

  it('leaves the preview to the reply before it', () => {
    const presentation = present([reply, titleNotice({ version: 1 })]);

    expect(presentation.latestReplyPreviewText).toBe(
      'The load test passed; only the security review is still open.'
    );
  });
});
