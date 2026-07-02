import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CompactThreadCard } from './CompactThreadCard';
import type { CompactThreadCardViewModel } from './types';

vi.mock('./CompactRoomView.css', () => ({
  AttentionDot: vi.fn(() => 'AttentionDot'),
  Card: 'Card',
  CardResolved: 'CardResolved',
  MessagePreview: 'MessagePreview',
  MessageRow: 'MessageRow',
  MessageText: 'MessageText',
  MetadataRow: 'MetadataRow',
  ParticipantAvatar: 'ParticipantAvatar',
  Participants: 'Participants',
  ScheduledIndicator: 'ScheduledIndicator',
  ScreenReaderText: 'ScreenReaderText',
  StatBadge: 'StatBadge',
  Stats: 'Stats',
  StatusChip: 'StatusChip',
  TimeText: 'TimeText',
  TitleLead: 'TitleLead',
  TitleRow: 'TitleRow',
  TitleText: 'TitleText',
  UnreadDot: 'UnreadDot',
  UnreadWrap: 'UnreadWrap',
}));

vi.mock('./ThreadIndicator.css', () => ({
  ThreadParticipant: 'ThreadParticipant',
  ThreadScheduledIcon: 'ThreadScheduledIcon',
  ThreadScheduledIndicator: 'ThreadScheduledIndicator',
  ThreadStreamingDot: 'ThreadStreamingDot',
  ThreadUnreadDot: 'ThreadUnreadDot',
}));

vi.mock('../messages/PendingSendIndicator.css', () => ({
  Container: 'PendingSendIndicator',
}));

vi.mock('../../hooks/useRelativeTime', () => ({
  useRelativeTime: () => '',
}));

vi.mock('../../components/user-avatar', () => ({
  UserAvatar: ({ renderFallback }: { renderFallback?: () => React.ReactNode }) =>
    renderFallback?.() ?? null,
}));

const makeViewModel = (
  overrides: Partial<CompactThreadCardViewModel> = {}
): CompactThreadCardViewModel => ({
  id: {
    roomId: '!room:server',
    threadRootId: '$thread',
  },
  titleText: 'Thread title',
  displayTitleText: 'Thread title',
  previewText: 'Me: Pending reply body',
  messageCount: 1,
  messageCountLabel: '1 msg',
  attentionState: 'waiting',
  attentionStatusText: 'Waiting on response',
  participants: [],
  tags: [],
  isResolved: false,
  isUnread: false,
  isStreaming: false,
  ...overrides,
});

describe('CompactThreadCard', () => {
  it('renders the pending send indicator beside compact preview text', () => {
    const renderer = create(
      <CompactThreadCard viewModel={makeViewModel({ hasPendingSend: true })} onClick={vi.fn()} />
    );

    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Me: Pending reply body');
    expect(rendered).toContain('Message sending');
    expect(rendered).toContain('Waiting for server');
    expect(rendered).toContain('data-pending-send-icon');

    renderer.unmount();
  });
});
