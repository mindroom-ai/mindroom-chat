import { describe, expect, it } from 'vitest';
import {
  buildThreadResolutionFromTagSnapshot,
  mergeCommandPaletteThreadItems,
  resolveCommandPaletteCurrentThreadRootId,
} from './commandPaletteThreadItems';
import type { CommandPaletteThreadItem } from '../command-palette/commandPaletteTypes';

const makeItem = (overrides: Partial<CommandPaletteThreadItem>): CommandPaletteThreadItem => ({
  id: 'room|thread',
  kind: 'thread',
  roomId: '!room:example.org',
  threadId: '$thread',
  summaryText: 'Thread',
  roomName: 'General',
  sortRank: 0,
  boost: 0,
  ...overrides,
});

describe('buildThreadResolutionFromTagSnapshot', () => {
  it('projects tag snapshots into ThreadRecord resolution input', () => {
    expect(
      buildThreadResolutionFromTagSnapshot({
        content: { tags: {} },
        isResolved: true,
        displayTags: ['done'],
      })
    ).toEqual({
      isResolved: true,
      tags: { done: true },
    });
  });

  it('returns undefined when no tag snapshot exists', () => {
    expect(buildThreadResolutionFromTagSnapshot(undefined)).toBeUndefined();
  });
});

describe('mergeCommandPaletteThreadItems', () => {
  it('keeps richer thread facts while taking the stronger ranks', () => {
    const merged = mergeCommandPaletteThreadItems(
      makeItem({
        summaryText: 'Existing summary',
        participantNames: ['Alice'],
        tags: ['todo'],
        isResolved: false,
        messageCount: 2,
        sortRank: 5,
        boost: 10,
      }),
      makeItem({
        summaryText: 'Thread',
        participantNames: [],
        tags: [],
        sortRank: 3,
        boost: 20,
      })
    );

    expect(merged.summaryText).toBe('Existing summary');
    expect(merged.participantNames).toEqual(['Alice']);
    expect(merged.tags).toEqual(['todo']);
    expect(merged.isResolved).toBe(false);
    expect(merged.messageCount).toBe(2);
    expect(merged.sortRank).toBe(5);
    expect(merged.boost).toBe(20);
  });
});

describe('resolveCommandPaletteCurrentThreadRootId', () => {
  it('canonicalizes the route thread id through the MindRoom thread owner', () => {
    const room = {
      getThread: () => undefined,
      findEventById: () => ({
        getId: () => '$reply',
        getTxnId: () => undefined,
        getUnsigned: () => ({}),
        isSending: () => false,
        threadRootId: '$root',
      }),
    };

    expect(resolveCommandPaletteCurrentThreadRootId(room as never, '$reply')).toBe('$root');
  });

  it('returns undefined when the command palette is not on a thread route', () => {
    expect(resolveCommandPaletteCurrentThreadRootId(undefined, '$reply')).toBeUndefined();
    expect(resolveCommandPaletteCurrentThreadRootId({} as never, undefined)).toBeUndefined();
  });
});
