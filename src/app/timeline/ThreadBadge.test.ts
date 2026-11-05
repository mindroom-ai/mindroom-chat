import type { ReactElement, ReactNode } from 'react';
import React from 'react';
import type { Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { renderThreadBadge, ThreadBadge } from './ThreadBadge';
import type { ThreadBadgeViewModel, ThreadRecord } from '../event-store/threads/types';

vi.mock('../messages/ThreadIndicator', () => ({
  ThreadIndicator: 'thread-indicator',
}));

vi.mock('../messages/thread-summary/ThreadSummaryCard', () => ({
  ThreadSummaryCard: 'mindroom-thread-summary-card',
}));

const findElementInNode = (
  node: ReactNode,
  predicate: (element: ReactElement) => boolean
): ReactElement | undefined => {
  if (!React.isValidElement(node)) return undefined;
  if (predicate(node)) return node;

  return React.Children.toArray(node.props.children)
    .map((child) => findElementInNode(child, predicate))
    .find((child): child is ReactElement => child !== undefined);
};

const makeEvent = (content: Record<string, unknown>, threadRootId?: string) =>
  ({
    getContent: () => content,
    getOriginalContent: () => content,
    threadRootId,
  } as any);

const makeRecord = (threadRootId = '$root'): ThreadRecord => ({
  roomId: '!room:example.org',
  threadRootId,
  rootEventId: threadRootId,
  presentation: {
    summaryInfo: undefined,
    summaryText: undefined,
    rootPreviewText: 'Root body',
    latestReplyPreviewText: undefined,
    lastSenderId: undefined,
    lastSenderDisplayName: undefined,
    messageCount: 2,
    participantIds: [],
    replyParticipantIds: ['@alice:example.org'],
    primarySummaryText: 'Root body',
    recentThreadSummaryText: 'Root body',
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 2,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    tags: [],
  },
  cache: {
    eventCount: 1,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  absoluteIndex: 0,
});

describe('ThreadBadge', () => {
  it('renders nothing without a badge model', () => {
    expect(
      ThreadBadge({
        model: undefined,
        room: {} as Room,
        onClick: vi.fn(),
      })
    ).toBeNull();
  });

  it('renders the summary card and thread indicator from the badge model', () => {
    const model: ThreadBadgeViewModel = {
      id: {
        roomId: '!room:example.org',
        threadRootId: '$root',
      },
      summaryInfo: {
        summaryText: 'Cached thread summary',
        generatedTs: 10,
        messageCount: 4,
      },
      recentThreadSummaryText: 'Recent summary',
      replyCount: 4,
      participantIds: ['@alice:example.org'],
      isResolved: true,
    };

    const rendered = ThreadBadge({
      model,
      room: {} as Room,
      onClick: vi.fn(),
      includeRecentSummaryData: true,
    });
    const summaryCard = findElementInNode(
      rendered,
      (element) => element.props.summaryInfo === model.summaryInfo
    );
    const threadIndicator = findElementInNode(
      rendered,
      (element) => element.props.threadRootId === '$root'
    );

    expect(summaryCard).toBeDefined();
    expect(threadIndicator).toBeDefined();
    expect(threadIndicator?.props.threadReplyCount).toBe(4);
    expect(threadIndicator?.props.threadParticipantIds).toEqual(['@alice:example.org']);
    expect(threadIndicator?.props.isResolved).toBe(true);
    expect(threadIndicator?.props['data-thread-summary']).toBe('Recent summary');
  });
});

describe('renderThreadBadge', () => {
  it('hides timeline thread badges inside an active thread', () => {
    expect(
      renderThreadBadge({
        eventId: '$root',
        event: makeEvent({}, undefined),
        threadRecordMap: new Map([['$root', makeRecord()]]),
        activeThreadId: '$root',
        room: {} as never,
        onClick: vi.fn(),
      })
    ).toBeNull();
  });

  it('renders the timeline thread badge seam with the derived model', () => {
    const badge = renderThreadBadge({
      eventId: '$root',
      event: makeEvent({}, undefined),
      threadRecordMap: new Map([['$root', makeRecord()]]),
      room: {} as never,
      onClick: vi.fn(),
      includeRecentSummaryData: true,
    });

    expect(React.isValidElement(badge)).toBe(true);
    expect((badge as React.ReactElement).props.model).toEqual({
      id: { roomId: '!room:example.org', threadRootId: '$root' },
      summaryInfo: undefined,
      recentThreadSummaryText: 'Root body',
      replyCount: 2,
      participantIds: ['@alice:example.org'],
      isResolved: false,
    });
    expect((badge as React.ReactElement).props.includeRecentSummaryData).toBe(true);
  });

  it('does not render a timeline thread badge without a record', () => {
    expect(
      renderThreadBadge({
        eventId: '$missing',
        event: makeEvent({}, undefined),
        threadRecordMap: new Map([['$root', makeRecord()]]),
        room: {} as never,
        onClick: vi.fn(),
      })
    ).toBeNull();
  });
});
