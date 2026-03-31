import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import { CompactRoomView } from './CompactRoomView';
import type { ThreadOverviewMetadata } from './roomThreadOverviewModel';

const { passthrough, renderedCardProps } = vi.hoisted(() => ({
  passthrough: 'div',
  renderedCardProps: vi.fn(),
}));

const makeMetadata = (overrides: Partial<ThreadOverviewMetadata> = {}): ThreadOverviewMetadata => ({
  isResolved: false,
  isUnread: false,
  isStreaming: false,
  scheduledTaskCount: 0,
  lastActivityTs: 1000,
  absoluteIndex: 0,
  lastSenderId: undefined,
  lastSenderDisplayName: undefined,
  participantDisplayName: undefined,
  summaryText: undefined,
  rootPreviewText: undefined,
  messageCount: 0,
  tags: [],
  ...overrides,
});

vi.mock('folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('folds')>();

  return {
    ...actual,
    Box: passthrough,
    Text: passthrough,
  };
});

vi.mock('./CompactThreadCard', () => ({
  CompactThreadCard: ({
    threadRootId,
    threadRootEvent,
    rootPreviewText,
    summaryInfo,
    onClick,
    room,
  }: {
    threadRootId: string;
    threadRootEvent?: { getId?: () => string | undefined };
    rootPreviewText?: string;
    summaryInfo?: MindroomThreadSummaryInfo;
    onClick: (threadRootId: string) => void;
    room: unknown;
  }) => {
    renderedCardProps({
      room,
      threadRootId,
      threadRootEventId: threadRootEvent?.getId?.(),
      rootPreviewText,
      summaryInfo,
    });

    return React.createElement(
      'button',
      {
        type: 'button',
        'data-thread-root-id': threadRootId,
        onClick: () => onClick(threadRootId),
      },
      summaryInfo?.summaryText ?? 'thread'
    );
  },
}));

vi.mock('./CompactRoomView.css', () => ({
  View: 'View',
  EmptyState: 'EmptyState',
}));

const makeEvent = (eventId: string) =>
  ({
    getId: () => eventId,
  } as never);

const makeRoom = ({
  rootEvent,
  fallbackEvent,
}: {
  rootEvent?: ReturnType<typeof makeEvent>;
  fallbackEvent?: ReturnType<typeof makeEvent>;
} = {}) =>
  ({
    getThread: vi.fn(() => (rootEvent ? { rootEvent } : undefined)),
    findEventById: vi.fn(() => fallbackEvent),
  } as never);

describe('CompactRoomView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an empty state when there are no thread roots', () => {
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: [],
        metadataMap: new Map(),
        onThreadClick: vi.fn(),
      })
    );

    expect(renderer.root.findAll((node) => node.children.includes('No threads'))).toHaveLength(1);
    expect(renderedCardProps).not.toHaveBeenCalled();
  });

  it('passes the room, live root event, and summary-map info through to each card', () => {
    const room = makeRoom({ rootEvent: makeEvent('$root') });
    const summaryInfo: MindroomThreadSummaryInfo = {
      summaryText: 'AI summary',
      messageCount: 42,
    };

    create(
      React.createElement(CompactRoomView, {
        room,
        threadRootIds: ['$thread-1'],
        metadataMap: new Map([['$thread-1', makeMetadata({ summaryText: 'metadata summary' })]]),
        summaryMap: new Map([['$thread-1', summaryInfo]]),
        onThreadClick: vi.fn(),
      })
    );

    expect(room.getThread).toHaveBeenCalledWith('$thread-1');
    expect(renderedCardProps).toHaveBeenCalledWith({
      room,
      threadRootId: '$thread-1',
      threadRootEventId: '$root',
      rootPreviewText: undefined,
      summaryInfo,
    });
  });

  it('falls back to metadata-derived summary info when no summary map entry exists', () => {
    const room = makeRoom({ fallbackEvent: makeEvent('$fallback-root') });

    create(
      React.createElement(CompactRoomView, {
        room,
        threadRootIds: ['$thread-2'],
        metadataMap: new Map([
          [
            '$thread-2',
            makeMetadata({
              summaryText: 'Fallback summary',
              messageCount: 7,
            }),
          ],
        ]),
        onThreadClick: vi.fn(),
      })
    );

    expect(room.findEventById).toHaveBeenCalledWith('$thread-2');
    expect(renderedCardProps).toHaveBeenCalledWith({
      room,
      threadRootId: '$thread-2',
      threadRootEventId: '$fallback-root',
      rootPreviewText: undefined,
      summaryInfo: {
        summaryText: 'Fallback summary',
        messageCount: 7,
      },
    });
  });

  it('passes metadata root preview text through to each card', () => {
    const room = makeRoom({ fallbackEvent: makeEvent('$fallback-root') });

    create(
      React.createElement(CompactRoomView, {
        room,
        threadRootIds: ['$thread-4'],
        metadataMap: new Map([
          [
            '$thread-4',
            makeMetadata({
              rootPreviewText: 'Edited root preview',
            }),
          ],
        ]),
        onThreadClick: vi.fn(),
      })
    );

    expect(renderedCardProps).toHaveBeenCalledWith({
      room,
      threadRootId: '$thread-4',
      threadRootEventId: '$fallback-root',
      rootPreviewText: 'Edited root preview',
      summaryInfo: undefined,
    });
  });

  it('prefers room events over stale thread root events when both exist', () => {
    const room = makeRoom({
      rootEvent: makeEvent('$stale-thread-root'),
      fallbackEvent: makeEvent('$fresh-room-root'),
    });

    create(
      React.createElement(CompactRoomView, {
        room,
        threadRootIds: ['$thread-5'],
        metadataMap: new Map([['$thread-5', makeMetadata()]]),
        onThreadClick: vi.fn(),
      })
    );

    expect(renderedCardProps).toHaveBeenCalledWith({
      room,
      threadRootId: '$thread-5',
      threadRootEventId: '$fresh-room-root',
      rootPreviewText: undefined,
      summaryInfo: undefined,
    });
  });

  it('forwards click events from a rendered card', () => {
    const onThreadClick = vi.fn();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom({ rootEvent: makeEvent('$root') }),
        threadRootIds: ['$thread-3'],
        metadataMap: new Map([['$thread-3', makeMetadata()]]),
        onThreadClick,
      })
    );

    const button = renderer.root.findByProps({ 'data-thread-root-id': '$thread-3' });

    act(() => {
      button.props.onClick();
    });

    expect(onThreadClick).toHaveBeenCalledWith('$thread-3');
  });
});
