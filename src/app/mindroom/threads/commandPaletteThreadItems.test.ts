import React from 'react';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildThreadResolutionFromTagSnapshot,
  mergeCommandPaletteThreadItems,
  resolveCommandPaletteCurrentThreadRootId,
  useMindroomCommandPaletteThreadItems,
} from './commandPaletteThreadItems';
import type { CommandPaletteThreadItem } from '../command-palette/commandPaletteTypes';
import { MINDROOM_THREAD_TAGS_EVENT } from './threadTags';

const { useAtomValueMock } = vi.hoisted(() => ({
  useAtomValueMock: vi.fn(),
}));

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai');
  return {
    ...actual,
    useAtomValue: useAtomValueMock,
  };
});

vi.mock('../recent-threads/recentThreads', () => ({
  makeRecentThreadsAtom: () => 'recent-threads-atom',
}));

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

const makeStandaloneMessageEvent = (eventId: string) =>
  new MatrixEvent({
    content: { body: 'Standalone message', msgtype: 'm.text' },
    event_id: eventId,
    origin_server_ts: 1,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
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

describe('useMindroomCommandPaletteThreadItems', () => {
  beforeEach(() => {
    useAtomValueMock.mockReturnValue([]);
  });

  it('resolves the current standalone zero-reply root without an SDK thread model', async () => {
    const sendStateEvent = vi.fn().mockResolvedValue(undefined);
    const standaloneRoot = makeStandaloneMessageEvent('$standalone');
    const selectedRoom = {
      roomId: '!room:example.org',
      name: 'Personal',
      findEventById: (eventId: string) => (eventId === '$standalone' ? standaloneRoot : undefined),
      getThread: () => undefined,
      getThreads: () => [],
      getLiveTimeline: () => ({
        getState: () => ({
          getStateEvents: () => [],
        }),
      }),
    };
    let snapshot: ReturnType<typeof useMindroomCommandPaletteThreadItems> | undefined;

    const Harness = () => {
      snapshot = useMindroomCommandPaletteThreadItems({
        mx: { sendStateEvent } as never,
        myUserId: '@alice:example.org',
        allJoinedRoomIds: [],
        getRoom: () => undefined,
        selectedRoom: selectedRoom as never,
        selectedRoomId: '!room:example.org',
        currentThreadId: '$standalone',
        navigateRoomThread: vi.fn(),
      });
      return null;
    };

    const renderer = create(React.createElement(Harness));

    await act(async () => {
      snapshot?.setCurrentThreadResolved(true);
    });

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_THREAD_TAGS_EVENT,
      expect.objectContaining({
        set_by: '@alice:example.org',
        set_at: expect.any(String),
      }),
      '["$standalone","resolved"]'
    );

    renderer.unmount();
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
