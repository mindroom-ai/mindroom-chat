import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  bumpRecentThreadMock,
  navigateRoomThreadMock,
  navigateRoomThreadDirectMock,
  rekeyRecentThreadMock,
} = vi.hoisted(() => ({
  bumpRecentThreadMock: vi.fn(),
  navigateRoomThreadMock: vi.fn(),
  navigateRoomThreadDirectMock: vi.fn(),
  rekeyRecentThreadMock: vi.fn(),
}));

vi.mock('folds', () => ({
  Text: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
}));

vi.mock('../../hooks/useRoomNavigate', () => ({
  useRoomNavigate: () => ({
    navigateRoomThread: navigateRoomThreadMock,
    navigateRoomThreadDirect: navigateRoomThreadDirectMock,
  }),
}));

vi.mock('../../hooks/useRelativeTime', () => ({
  useRelativeTime: () => '1m ago',
}));

vi.mock('../../hooks/useRoomMeta', () => ({
  useRoomName: () => 'Room Name',
}));

vi.mock('../../state/recentThreads', () => ({
  bumpRecentThread: bumpRecentThreadMock,
  rekeyRecentThread: rekeyRecentThreadMock,
}));

vi.mock('./useRecentThreadSummary', () => ({
  useRecentThreadSummary: () => ({
    summary: 'Thread summary',
    resolvedThreadId: '$resolved',
  }),
}));

vi.mock('./recentThreads.css', () => ({
  EntryButton: 'EntryButton',
  EntryTopRow: 'EntryTopRow',
  EntryRoomName: 'EntryRoomName',
  EntryTime: 'EntryTime',
  EntrySummary: 'EntrySummary',
}));

import { RecentThreadEntry } from './RecentThreadEntry';

describe('RecentThreadEntry', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
    }
    renderer = undefined;
    vi.clearAllMocks();
  });

  it('navigates recent-thread clicks directly to the target thread route', () => {
    act(() => {
      renderer = create(
        React.createElement(RecentThreadEntry, {
          room: { roomId: '!room:example.org', hasEncryptionStateEvent: () => false } as never,
          threadId: '$thread',
          openedAt: Date.now(),
        })
      );
    });

    const button = renderer!.root.findByType('button');

    act(() => {
      button.props.onClick();
    });

    expect(navigateRoomThreadDirectMock).toHaveBeenCalledWith('!room:example.org', '$resolved');
    expect(navigateRoomThreadMock).not.toHaveBeenCalled();
  });

  it('persists a resolved summary snapshot without waiting for room view state', () => {
    act(() => {
      renderer = create(
        React.createElement(RecentThreadEntry, {
          room: { roomId: '!room:example.org', hasEncryptionStateEvent: () => false } as never,
          threadId: '$thread',
          openedAt: Date.now(),
        })
      );
    });

    expect(bumpRecentThreadMock).toHaveBeenCalledWith(
      '!room:example.org',
      '$thread',
      expect.any(Number),
      'Thread summary'
    );
  });
});
