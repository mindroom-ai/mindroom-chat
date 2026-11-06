import { describe, expect, it } from 'vitest';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import type { TFunction } from 'i18next';
import { buildCrossRoomThreadIndexEntry } from '../crossRoomThreadIndex';
import { getThreadPrimarySummaryText } from '../../../event-store/threads/threadPresentation';

// Regression (L5-F010): on a new device that had not unlocked the key backup yet, the sidebar's
// THREADS list titled the threads of an encrypted room "** Unable to decrypt: DecryptionError:
// ... **", the body the SDK gives an event it cannot decrypt.

const SDK_ERROR_BODY =
  '** Unable to decrypt: DecryptionError: This message was sent before this device logged in, and key backup is not working. **';

const t = ((key: string) => `translated:${key}`) as unknown as TFunction;

const undecryptableRoot = (): MatrixEvent =>
  ({
    getId: () => '$root',
    getSender: () => '@person:example.org',
    getTs: () => 100,
    getType: () => 'm.room.message',
    getContent: () => ({ msgtype: 'm.bad.encrypted', body: SDK_ERROR_BODY }),
    getUnsigned: () => ({}),
    getRelation: () => undefined,
    isRelation: () => false,
    isRedacted: () => false,
    isRedaction: () => false,
    replacingEvent: () => undefined,
  } as unknown as MatrixEvent);

const timelineSet = (events: MatrixEvent[]) => ({
  relations: { getChildEventsForEvent: () => undefined },
  getLiveTimeline: () => ({ getEvents: () => events, getNeighbouringTimeline: () => undefined }),
});

const roomWith = (root: MatrixEvent): Room => {
  const thread = {
    rootEvent: root,
    events: [],
    timeline: [],
    length: 0,
    lastReply: () => null,
    getUnfilteredTimelineSet: () => timelineSet([root]),
  } as unknown as Thread;
  return {
    roomId: '!secure:example.org',
    name: 'Secure room',
    getThread: (id: string) => (id === '$root' ? thread : null),
    findEventById: (id: string) => (id === '$root' ? root : undefined),
    getMember: () => undefined,
    getEventReadUpTo: () => undefined,
    getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => undefined }) }),
    getUnfilteredTimelineSet: () => timelineSet([root]),
    hasEncryptionStateEvent: () => true,
  } as unknown as Room;
};

describe('a thread whose root the client cannot decrypt', () => {
  it('is titled with the translated placeholder, never the SDK error text', () => {
    const entry = buildCrossRoomThreadIndexEntry({
      room: roomWith(undecryptableRoot()),
      threadRootId: '$root',
      currentUserId: '@reader:example.org',
      tagSnapshot: null,
    });

    expect(entry).toBeDefined();
    expect(getThreadPrimarySummaryText(entry!.threadRecord.presentation, t)).toBe(
      'translated:sharedUi.threadPreviews.encrypted'
    );
    expect(entry!.summaryText).not.toMatch(/Unable to decrypt|DecryptionError/);
    expect(entry!.searchableText).not.toMatch(/unable to decrypt|decryptionerror/i);
  });
});
