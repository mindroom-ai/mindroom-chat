import { describe, expect, it } from 'vitest';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import {
  isRenderableEvent,
  mergeClassicRoomThreadReplyEntries,
  type TimelineEventEntry,
} from './roomTimelineEvents';

const makeEvent = (eventId: string, ts: number, threadRootId?: string) =>
  ({
    getId: () => eventId,
    getSender: () => '@sender:server',
    getType: () => 'm.room.message',
    getContent: () => ({ msgtype: 'm.text', body: eventId }),
    getStateKey: () => undefined,
    getRelation: () => undefined,
    getTs: () => ts,
    isRedacted: () => false,
    isRedaction: () => false,
    threadRootId,
  } as never);

const makeEntry = (event: ReturnType<typeof makeEvent>, absoluteIndex: number) => ({
  event,
  absoluteIndex,
});

describe('mergeClassicRoomThreadReplyEntries', () => {
  it('merges loaded thread replies for roots present in the room timeline', () => {
    const root = makeEvent('$root', 10);
    const reply = makeEvent('$reply', 20, '$root');
    const later = makeEvent('$later', 30);
    const entries: TimelineEventEntry[] = [makeEntry(root, 5), makeEntry(later, 6)];
    const room = {
      getThread: (threadId: string) =>
        threadId === '$root'
          ? {
              id: '$root',
              events: [root, reply],
            }
          : undefined,
    } as never;

    const merged = mergeClassicRoomThreadReplyEntries({
      renderableEventEntries: entries,
      room,
      ignoredUsersSet: new Set(),
      showHiddenEvents: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
    });

    expect(merged.map(({ event }) => event.getId())).toEqual(['$root', '$reply', '$later']);
    expect(merged.find(({ event }) => event.getId() === '$root')?.absoluteIndex).toBe(5);
    expect(merged.find(({ event }) => event.getId() === '$reply')?.absoluteIndex).toBeGreaterThan(
      5
    );
    expect(merged.find(({ event }) => event.getId() === '$reply')?.absoluteIndex).toBeLessThan(6);
    expect(merged.find(({ event }) => event.getId() === '$later')?.absoluteIndex).toBe(6);
  });

  it('does not duplicate replies that are already present in the room timeline', () => {
    const root = makeEvent('$root', 10);
    const reply = makeEvent('$reply', 20, '$root');
    const later = makeEvent('$later', 30);
    const entries: TimelineEventEntry[] = [
      makeEntry(root, 5),
      makeEntry(reply, 6),
      makeEntry(later, 7),
    ];
    const room = {
      getThread: (threadId: string) =>
        threadId === '$root'
          ? {
              id: '$root',
              events: [root, reply],
            }
          : undefined,
    } as never;

    const merged = mergeClassicRoomThreadReplyEntries({
      renderableEventEntries: entries,
      room,
      ignoredUsersSet: new Set(),
      showHiddenEvents: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
    });

    expect(merged).toEqual(entries);
  });

  it('ignores thread replies whose roots are not loaded in the room timeline', () => {
    const root = makeEvent('$root', 10);
    const entries: TimelineEventEntry[] = [makeEntry(root, 5)];
    const room = {
      getThread: () => undefined,
    } as never;

    const merged = mergeClassicRoomThreadReplyEntries({
      renderableEventEntries: entries,
      room,
      ignoredUsersSet: new Set(),
      showHiddenEvents: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
    });

    expect(merged).toEqual(entries);
  });

  it('does not scan unrelated room thread models while merging classic replies', () => {
    const root = makeEvent('$root', 10);
    const reply = makeEvent('$reply', 20, '$root');
    const entries: TimelineEventEntry[] = [makeEntry(root, 5)];
    const room = {
      getThread: (threadId: string) =>
        threadId === '$root'
          ? {
              id: '$root',
              events: [root, reply],
            }
          : undefined,
      getThreads: () => {
        throw new Error('classic merge should not scan every room thread');
      },
    } as never;

    const merged = mergeClassicRoomThreadReplyEntries({
      renderableEventEntries: entries,
      room,
      ignoredUsersSet: new Set(),
      showHiddenEvents: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
    });

    expect(merged.map(({ event }) => event.getId())).toEqual(['$root', '$reply']);
  });
});

describe('isRenderableEvent', () => {
  it('never shows a reference, such as an encrypted copy of a canvas state not decrypted yet', () => {
    const encryptedCopy = new MatrixEvent({
      type: 'm.room.encrypted',
      event_id: '$copy',
      room_id: '!room:server',
      sender: '@alice:server',
      origin_server_ts: 1,
      content: {
        algorithm: 'm.megolm.v1.aes-sha2',
        ciphertext: 'secret',
        'm.relates_to': { rel_type: 'm.reference', event_id: '$canvas' },
      },
    });
    const room = {} as Room;
    expect(isRenderableEvent(encryptedCopy, room, undefined, new Set(), false, false, false)).toBe(
      false
    );
    expect(isRenderableEvent(encryptedCopy, room, undefined, new Set(), true, false, false)).toBe(
      true
    );
  });
});
