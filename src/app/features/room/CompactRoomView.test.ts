import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompactThreadCardViewModel, ThreadRecord } from '../../mindroom/threads/types';
import { CompactRoomView } from './CompactRoomView';

const { passthrough, renderedCardProps, useCompactThreadCardViewModelsMock } = vi.hoisted(() => ({
  passthrough: 'div',
  renderedCardProps: vi.fn(),
  useCompactThreadCardViewModelsMock: vi.fn(),
}));

const makeViewModel = (
  threadRootId: string,
  overrides: Partial<CompactThreadCardViewModel> = {}
): CompactThreadCardViewModel => ({
  id: {
    roomId: '!room:server',
    threadRootId,
  },
  titleText: 'Thread title',
  displayTitleText: 'Thread title',
  previewText: 'Latest reply',
  primarySummaryText: 'Primary summary',
  recentThreadSummaryText: 'Recent summary',
  messageCount: 2,
  messageCountLabel: '2 msgs',
  attentionState: 'idle',
  attentionStatusText: 'Idle',
  participants: [],
  tags: [],
  isResolved: false,
  isUnread: false,
  isStreaming: false,
  ...overrides,
});

const makeThreadRecord = (
  threadRootId: string,
  overrides: Partial<ThreadRecord> = {}
): ThreadRecord => ({
  roomId: '!room:server',
  threadRootId,
  rootEventId: threadRootId,
  presentation: {
    messageCount: 0,
    participantIds: [],
  },
  status: {
    isKnownThreadRoot: true,
    replyCount: 0,
    isResolved: false,
    isUnread: false,
    isStreaming: false,
    scheduledTaskCount: 0,
    tags: [],
  },
  cache: {
    eventCount: 0,
    relationSnapshotComplete: false,
    tailLoaded: false,
  },
  absoluteIndex: 0,
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

vi.mock('../../mindroom/threads/compactThreadCardViewModel', () => ({
  useCompactThreadCardViewModels: useCompactThreadCardViewModelsMock,
}));

vi.mock('./CompactThreadCard', () => ({
  CompactThreadCard: ({
    viewModel,
    onClick,
  }: {
    viewModel: CompactThreadCardViewModel;
    onClick: (threadRootId: string, summaryText?: string) => void;
  }) => {
    renderedCardProps({ viewModel });

    return React.createElement(
      'button',
      {
        type: 'button',
        'data-thread-root-id': viewModel.id.threadRootId,
        onClick: () => onClick(viewModel.id.threadRootId, viewModel.primarySummaryText),
      },
      viewModel.titleText
    );
  },
}));

vi.mock('./CompactRoomView.css', () => ({
  View: 'View',
  EmptyState: 'EmptyState',
}));

const makeRoom = () =>
  ({
    roomId: '!room:server',
  } as never);

describe('CompactRoomView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCompactThreadCardViewModelsMock.mockReturnValue([]);
  });

  it('renders an empty state when there are no thread roots', () => {
    const room = makeRoom();
    const renderer = create(
      React.createElement(CompactRoomView, {
        room,
        threadRootIds: [],
        threadRecordMap: new Map(),
        onThreadClick: vi.fn(),
      })
    );

    expect(useCompactThreadCardViewModelsMock).toHaveBeenCalledWith({
      room,
      threadRootIds: [],
      threadRecordMap: new Map(),
    });
    expect(renderer.root.findAll((node) => node.children.includes('No threads'))).toHaveLength(1);
    expect(renderedCardProps).not.toHaveBeenCalled();
  });

  it('builds compact card view models through the shared MindRoom selector', () => {
    const room = makeRoom();
    const threadRecordMap = new Map([['$thread-1', makeThreadRecord('$thread-1')]]);
    const viewModel = makeViewModel('$thread-1', { titleText: 'AI summary' });
    useCompactThreadCardViewModelsMock.mockReturnValue([viewModel]);

    create(
      React.createElement(CompactRoomView, {
        room,
        threadRootIds: ['$thread-1'],
        threadRecordMap,
        onThreadClick: vi.fn(),
      })
    );

    expect(useCompactThreadCardViewModelsMock).toHaveBeenCalledWith({
      room,
      threadRootIds: ['$thread-1'],
      threadRecordMap,
    });
    expect(renderedCardProps).toHaveBeenCalledWith({ viewModel });
  });

  it('forwards card clicks using the recent-thread summary from the view model', () => {
    const onThreadClick = vi.fn();
    const viewModel = makeViewModel('$thread-3', {
      primarySummaryText: 'Card title',
      recentThreadSummaryText: 'Recent sidebar summary',
    });
    useCompactThreadCardViewModelsMock.mockReturnValue([viewModel]);
    const renderer = create(
      React.createElement(CompactRoomView, {
        room: makeRoom(),
        threadRootIds: ['$thread-3'],
        threadRecordMap: new Map([['$thread-3', makeThreadRecord('$thread-3')]]),
        onThreadClick,
      })
    );

    const button = renderer.root.findByProps({ 'data-thread-root-id': '$thread-3' });

    act(() => {
      button.props.onClick();
    });

    expect(onThreadClick).toHaveBeenCalledWith('$thread-3', 'Recent sidebar summary');
  });
});
