import { RelationType } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getSearchResultOpenTarget } from './searchResultOpenTarget';

describe('getSearchResultOpenTarget', () => {
  it('returns the event id for a room-level message', () => {
    expect(
      getSearchResultOpenTarget({
        event_id: '$room-message',
        content: {},
      })
    ).toEqual({
      mainEventId: '$room-message',
      threadRootId: undefined,
    });
  });

  it('returns the thread root for a threaded reply', () => {
    expect(
      getSearchResultOpenTarget({
        event_id: '$thread-reply',
        content: {
          'm.relates_to': {
            rel_type: RelationType.Thread,
            event_id: '$thread-root',
          },
        },
      })
    ).toEqual({
      mainEventId: '$thread-reply',
      threadRootId: '$thread-root',
    });
  });

  it('marks a thread title notice, by its shape, as opening its thread', () => {
    const notice = (content: Record<string, unknown>) =>
      getSearchResultOpenTarget({
        event_id: '$title',
        content: {
          msgtype: 'm.notice',
          body: 'Launch roadmap',
          'm.relates_to': { rel_type: RelationType.Thread, event_id: '$thread-root' },
          ...content,
        },
      }).threadTitle;
    expect(
      notice({ 'io.mindroom.thread_summary': { version: 1, summary: 'Launch roadmap' } })
    ).toBe(true);
    // The same words as a plain notice or a message are no title.
    expect(notice({})).toBeUndefined();
    expect(
      notice({ msgtype: 'm.text', 'io.mindroom.thread_summary': { version: 1 } })
    ).toBeUndefined();
  });

  it('keeps replacement targets and does not infer a thread root from edits', () => {
    expect(
      getSearchResultOpenTarget({
        event_id: '$edit-event',
        content: {
          'm.relates_to': {
            rel_type: RelationType.Replace,
            event_id: '$edited-message',
          },
        },
      })
    ).toEqual({
      mainEventId: '$edited-message',
      threadRootId: undefined,
    });
  });

  it('returns no thread root for a thread root event itself', () => {
    expect(
      getSearchResultOpenTarget({
        event_id: '$thread-root',
        content: {},
      })
    ).toEqual({ mainEventId: '$thread-root', threadRootId: undefined });
  });

  it('does not infer thread root from an edit of a threaded message', () => {
    expect(
      getSearchResultOpenTarget({
        event_id: '$edit-of-thread-reply',
        content: {
          'm.relates_to': {
            rel_type: RelationType.Replace,
            event_id: '$thread-reply',
          },
        },
      })
    ).toEqual({ mainEventId: '$thread-reply', threadRootId: undefined });
  });
});
