import { beforeAll, describe, expect, it } from 'vitest';
import { makeEvent, makeRoom } from '../../timeline/test-utils/RoomTimeline.test.shared';

// The shared room timeline harness registers its module mocks when it loads, so the module under
// test is imported after it.
let shouldRefreshOverviewForTimelineEvent: typeof import('./threadBootstrap').shouldRefreshOverviewForTimelineEvent;

beforeAll(async () => {
  ({ shouldRefreshOverviewForTimelineEvent } = await import('./threadBootstrap'));
});

describe('shouldRefreshOverviewForTimelineEvent', () => {
  it('refreshes overview metadata only for thread-targeted timeline events', async () => {
    const threadRoot = makeEvent('$thread-root', { isThreadRoot: true });
    const threadReply = makeEvent('$thread-reply', {
      threadRootId: threadRoot.getId(),
    });
    const roomMessage = makeEvent('$message');
    const threadRootEdit = makeEvent('$thread-root-edit', {
      associatedId: threadRoot.getId(),
      relation: { rel_type: 'm.replace', event_id: threadRoot.getId() },
    });
    const threadReplyEdit = makeEvent('$thread-reply-edit', {
      associatedId: threadReply.getId(),
      relation: { rel_type: 'm.replace', event_id: threadReply.getId() },
    });
    const roomAnnotation = makeEvent('$annotation', {
      associatedId: roomMessage.getId(),
      relation: { rel_type: 'm.annotation', event_id: roomMessage.getId() },
    });
    const room = makeRoom({
      liveEvents: [threadRoot, roomMessage],
      findEventById: (eventId: string) => {
        if (eventId === threadRoot.getId()) return threadRoot;
        if (eventId === threadReply.getId()) return threadReply;
        if (eventId === roomMessage.getId()) return roomMessage;
        return undefined;
      },
    });

    expect(shouldRefreshOverviewForTimelineEvent(room as never, roomMessage as never)).toBe(false);
    expect(shouldRefreshOverviewForTimelineEvent(room as never, threadRoot as never)).toBe(true);
    expect(shouldRefreshOverviewForTimelineEvent(room as never, threadReply as never)).toBe(true);
    expect(shouldRefreshOverviewForTimelineEvent(room as never, threadRootEdit as never)).toBe(
      true
    );
    expect(shouldRefreshOverviewForTimelineEvent(room as never, threadReplyEdit as never)).toBe(
      true
    );
    expect(shouldRefreshOverviewForTimelineEvent(room as never, roomAnnotation as never)).toBe(
      false
    );
  });
});
