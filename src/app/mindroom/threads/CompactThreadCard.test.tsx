import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CompactThreadCard } from './CompactThreadCard';
import type { CompactThreadCardViewModel } from './types';

vi.mock('./CompactRoomView.css', () => ({
  Card: 'Card',
  CardResolved: 'CardResolved',
  LeadingSlot: 'LeadingSlot',
  MessagePreview: 'MessagePreview',
  MessageRow: 'MessageRow',
  MessageText: 'MessageText',
  MetadataRow: 'MetadataRow',
  ParticipantAvatar: 'ParticipantAvatar',
  Participants: 'Participants',
  ScheduledIndicator: 'ScheduledIndicator',
  StatBadge: 'StatBadge',
  Stats: 'Stats',
  StatusChip: 'StatusChip',
  ResolutionByline: 'ResolutionByline',
  TimeText: 'TimeText',
  TitleLead: 'TitleLead',
  TitleRow: 'TitleRow',
  TitleText: 'TitleText',
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

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test-utils/i18n');
  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        key === 'thread.aria.messageFailed'
          ? 'Localized message failure'
          : translateFromEn(key, options),
    }),
  };
});

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

  it('renders terminal failure instead of pending state beside compact preview text', () => {
    const renderer = create(
      <CompactThreadCard
        viewModel={makeViewModel({ hasPendingSend: true, hasFailedSend: true })}
        onClick={vi.fn()}
      />
    );

    const rendered = JSON.stringify(renderer.toJSON());
    const ariaLabel = renderer.root.findByType('button').props['aria-label'];

    expect(rendered).toContain('Me: Pending reply body');
    expect(rendered).toContain('Message failed to send');
    expect(rendered).toContain('Not sent');
    expect(rendered).toContain('data-failed-send-icon');
    expect(rendered).not.toContain('data-pending-send-icon');
    expect(ariaLabel).toContain('Localized message failure');
    expect(ariaLabel).not.toContain('Message failed to send');

    renderer.unmount();
  });

  it('marks only unread threads with a leading dot and no attention-state color', () => {
    const readRenderer = create(
      <CompactThreadCard
        viewModel={makeViewModel({
          attentionState: 'needs-attention',
          attentionStatusText: 'Needs attention',
        })}
        onClick={vi.fn()}
      />
    );
    expect(readRenderer.root.findAllByProps({ 'data-thread-unread-dot': 'true' })).toHaveLength(0);
    expect(JSON.stringify(readRenderer.toJSON())).not.toContain('ThreadUnreadDot');
    readRenderer.unmount();

    const unreadRenderer = create(
      <CompactThreadCard viewModel={makeViewModel({ isUnread: true })} onClick={vi.fn()} />
    );
    const dot = unreadRenderer.root.findByProps({ 'data-thread-unread-dot': 'true' });
    const button = unreadRenderer.root.findByType('button');

    expect(dot.props.title).toBe('Unread messages');
    expect(button.props['aria-label']).toContain('Unread messages');
    unreadRenderer.unmount();
  });

  it('keeps the attention state on the card for the accessible label and test hooks', () => {
    const viewModel = makeViewModel({
      attentionState: 'resolved',
      attentionStatusText: 'Resolved',
      isResolved: true,
      resolvedByDisplayName: 'Alice',
    } as Partial<CompactThreadCardViewModel> & { resolvedByDisplayName: string });
    const renderer = create(<CompactThreadCard viewModel={viewModel} onClick={vi.fn()} />);
    const button = renderer.root.findByType('button');

    expect(button.props['data-attention-state']).toBe('resolved');
    expect(button.props['aria-label']).toContain('Resolved by Alice');

    renderer.unmount();
  });

  it('renders an explicit resolver byline for resolved cards', () => {
    const viewModel = makeViewModel({
      attentionState: 'resolved',
      attentionStatusText: 'Resolved',
      isResolved: true,
      resolvedByDisplayName: 'Alice',
    } as Partial<CompactThreadCardViewModel> & { resolvedByDisplayName: string });
    const renderer = create(<CompactThreadCard viewModel={viewModel} onClick={vi.fn()} />);
    const resolverByline = renderer.root.findByProps({
      'data-compact-card-resolution-byline': 'true',
    });

    expect(resolverByline.findByType('span').children).toContain('Resolved by Alice');

    renderer.unmount();
  });
});
