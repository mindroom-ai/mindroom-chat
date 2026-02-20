import { describe, expect, it } from 'vitest';
import { eventBelongsToThread } from './threadUtils';

const makeEvent = (eventId: string, threadRootId?: string) => ({
  getId: () => eventId,
  threadRootId,
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
