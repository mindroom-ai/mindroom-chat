import { describe, expect, it } from 'vitest';
import { RelationType } from 'matrix-js-sdk';
import { buildThreadReplyCountMap, eventBelongsToThread, isThreadReplyEvent } from './threadUtils';

const makeEvent = (
  eventId: string,
  threadRootId?: string,
  relationType?: string
) => ({
  getId: () => eventId,
  threadRootId,
  getRelation: () => (relationType ? { rel_type: relationType } : undefined),
});

describe('eventBelongsToThread', () => {
  it('matches thread root events by event id', () => {
    expect(eventBelongsToThread(makeEvent('$root'), '$root')).toBe(true);
  });

  it('matches thread reply events by threadRootId', () => {
    expect(eventBelongsToThread(makeEvent('$reply', '$root'), '$root')).toBe(true);
  });

  it('does not match unrelated events', () => {
    expect(eventBelongsToThread(makeEvent('$other', '$different-root'), '$root')).toBe(false);
  });
});

describe('isThreadReplyEvent', () => {
  it('returns false for unthreaded events', () => {
    expect(isThreadReplyEvent('$event')).toBe(false);
  });

  it('returns false for thread root events associated to their own thread', () => {
    expect(isThreadReplyEvent('$root', '$root')).toBe(false);
  });

  it('returns true for thread reply events', () => {
    expect(isThreadReplyEvent('$reply', '$root')).toBe(true);
  });
});

describe('buildThreadReplyCountMap', () => {
  it('counts thread replies by root id', () => {
    const counts = buildThreadReplyCountMap([
      makeEvent('$reply1', '$root', RelationType.Thread),
      makeEvent('$reply2', '$root', RelationType.Thread),
      makeEvent('$reply3', '$other-root', RelationType.Thread),
    ]);

    expect(counts.get('$root')).toBe(2);
    expect(counts.get('$other-root')).toBe(1);
  });

  it('ignores non-thread relation events', () => {
    const counts = buildThreadReplyCountMap([
      makeEvent('$thread-reply', '$root', RelationType.Thread),
      makeEvent('$annotation', '$root', RelationType.Annotation),
      makeEvent('$edit', '$root', RelationType.Replace),
    ]);

    expect(counts.get('$root')).toBe(1);
  });

  it('deduplicates repeated events by event id', () => {
    const duplicateReply = makeEvent('$reply', '$root', RelationType.Thread);
    const counts = buildThreadReplyCountMap([duplicateReply, duplicateReply]);

    expect(counts.get('$root')).toBe(1);
  });
});
