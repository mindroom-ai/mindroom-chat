import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ThreadsViewRow } from '../ThreadsViewRow';
import type { CrossRoomThreadIndexEntry } from '../../cross-room/crossRoomThreadIndex';

const { navigateRoomThreadMock } = vi.hoisted(() => ({
  navigateRoomThreadMock: vi.fn(),
}));

vi.mock('../../useInitializeShownThread', () => ({
  useInitializeShownThread: () => undefined,
}));
vi.mock('../ThreadsView.css', () => ({
  Row: 'row',
  RowChrome: 'row-chrome',
  Chip: 'chip',
}));

vi.mock('folds', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  Box: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement('div', props, children),
  Icon: () => React.createElement('span', null),
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) =>
    React.createElement('span', props, children),
  Icons: {
    Hash: 'Hash',
    Space: 'Space',
  },
}));

vi.mock('../../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@me:example.org',
    getRoom: (roomId: string) =>
      roomId === '!room:example.org'
        ? { roomId, name: 'Room', isSpaceRoom: () => false }
        : { roomId, name: 'Space', isSpaceRoom: () => true },
  }),
}));

vi.mock('../../../matrix/hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../navigation/useRoomNavigate', () => ({
  useRoomNavigate: () => ({ navigateRoomThread: navigateRoomThreadMock }),
}));

vi.mock('../../overview/compactThreadCardViewModel', () => ({
  buildCompactThreadCardViewModelFromRecord: () => ({
    id: { roomId: '!room:example.org', threadRootId: '$root' },
    titleText: 'Thread',
    displayTitleText: 'Thread',
    previewText: 'Preview',
    messageCount: 1,
    messageCountLabel: '1 msg',
    messageCountText: '1',
    attentionState: 'idle',
    attentionStatusText: 'Idle',
    participants: [],
    tags: [],
    isResolved: false,
    isUnread: false,
    isStreaming: false,
  }),
}));

vi.mock('../../overview/CompactThreadCard', () => ({
  CompactThreadCard: ({ onClick }: { onClick: () => void }) =>
    React.createElement('button', { type: 'button', onClick }, 'card'),
}));

describe('ThreadsViewRow', () => {
  it('renders room context and navigates with navigateRoomThread', () => {
    const entry = {
      roomId: '!room:example.org',
      roomName: 'Room',
      parentSpaceIds: ['!space:example.org'],
      threadRootId: '$root',
      threadRecord: {},
    } as CrossRoomThreadIndexEntry;
    const renderer = create(React.createElement(ThreadsViewRow, { entry }));

    expect(renderer.root.findAllByProps({ children: 'Room' }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ children: 'Space' }).length).toBeGreaterThan(0);

    act(() => {
      renderer.root.findByType('button').props.onClick();
    });

    expect(navigateRoomThreadMock).toHaveBeenCalledWith('!room:example.org', '$root');
  });
});
