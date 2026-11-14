import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { CompactThreadCard } from './CompactThreadCard';
import type { CompactThreadCardViewModel } from '../../event-store/threads/types';

vi.mock('./CompactRoomView.css', () => ({
  Card: 'Card',
  CardResolved: 'CardResolved',
  CardUnread: 'CardUnread',
  MessagePreview: 'MessagePreview',
  MessageText: 'MessageText',
  MetadataRow: 'MetadataRow',
  ParticipantAvatar: 'ParticipantAvatar',
  Participants: 'Participants',
  ReplyCount: 'ReplyCount',
  ResolutionByline: 'ResolutionByline',
  ResolutionBylineLabel: 'ResolutionBylineLabel',
  ResolvedBadge: 'ResolvedBadge',
  ScheduledIndicator: 'ScheduledIndicator',
  Stats: 'Stats',
  StreamingStatus: 'StreamingStatus',
  TimeText: 'TimeText',
  TimeTextUnread: 'TimeTextUnread',
  TitleRow: 'TitleRow',
  TitleText: 'TitleText',
}));

vi.mock('../../messages/ThreadIndicator.css', () => ({
  ThreadParticipant: 'ThreadParticipant',
  ThreadScheduledIcon: 'ThreadScheduledIcon',
  ThreadScheduledIndicator: 'ThreadScheduledIndicator',
  ThreadStreamingDot: 'ThreadStreamingDot',
}));

vi.mock('../../ui/PendingSendIndicator.css', () => ({
  Container: 'PendingSendIndicator',
}));

const relativeTime = vi.hoisted(() => ({ value: '', format: undefined as string | undefined }));

vi.mock('../../i18n/useRelativeTime', () => ({
  useRelativeTime: (_ts: number | undefined, format?: string) => {
    relativeTime.format = format;
    return relativeTime.value;
  },
}));

vi.mock('../tags/ThreadTagPill', () => ({
  ThreadTagPill: ({ name }: { name: string }) =>
    React.createElement('span', { 'data-tag-pill': name }, name),
}));

vi.mock('../../avatars/UserAvatar', () => ({
  UserAvatar: ({ renderFallback }: { renderFallback?: () => React.ReactNode }) =>
    renderFallback?.() ?? null,
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return {
    useTranslation: () => ({
      i18n: { language: 'en' },
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
  messageCountText: '1',
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
  it('shows when a snooze ends, and nothing once its time passes', () => {
    vi.useFakeTimers();
    try {
      const until = Date.now() + 30 * 60_000;
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <CompactThreadCard
            viewModel={makeViewModel({ snoozedUntilTs: until })}
            onClick={vi.fn()}
          />
        );
      });
      const shown = () =>
        renderer.root.findAll(
          (n) => typeof n.type === 'string' && n.props['data-thread-snoozed'] === 'true'
        );
      expect(JSON.stringify(renderer.toJSON())).toContain(
        `Snoozed until ${new Intl.DateTimeFormat('en', {
          hour: 'numeric',
          minute: '2-digit',
        }).format(until)}`
      );
      expect(shown().length).toBeGreaterThan(0);
      act(() => {
        vi.advanceTimersByTime(30 * 60_000);
      });
      expect(JSON.stringify(renderer.toJSON())).not.toContain('Snoozed until');
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('marks unread threads with an accent edge and accented time instead of a dot', () => {
    relativeTime.value = '2d';
    const readRenderer = create(
      <CompactThreadCard
        viewModel={makeViewModel({
          attentionState: 'needs-attention',
          attentionStatusText: 'Needs attention',
        })}
        onClick={vi.fn()}
      />
    );
    const readButton = readRenderer.root.findByType('button');
    expect(readButton.props.className).toBe('Card');
    expect(readButton.props['data-thread-unread']).toBeUndefined();
    expect(readRenderer.root.findByProps({ className: 'TimeText' }).props.children).toBe('2d');
    readRenderer.unmount();

    const unreadRenderer = create(
      <CompactThreadCard
        viewModel={makeViewModel({ isUnread: true, isResolved: true })}
        onClick={vi.fn()}
      />
    );
    const button = unreadRenderer.root.findByType('button');

    expect(button.props.className).toBe('Card CardResolved CardUnread');
    expect(button.props['data-thread-unread']).toBe('true');
    expect(
      unreadRenderer.root.findByProps({ className: 'TimeText TimeTextUnread' }).props.children
    ).toBe('2d');
    expect(JSON.stringify(unreadRenderer.toJSON())).not.toContain('UnreadDot');
    expect(button.props['aria-label']).toContain('Unread messages');
    unreadRenderer.unmount();
    relativeTime.value = '';
  });

  it('asks for the compact time and reads the full timestamp to assistive technology', () => {
    relativeTime.value = '2d';
    const renderer = create(
      <CompactThreadCard
        viewModel={makeViewModel({
          lastActivityTs: 1,
          lastActivityTitle: 'Oct 2, 2026, 14:00',
        })}
        onClick={vi.fn()}
      />
    );

    expect(relativeTime.format).toBe('compact');
    expect(renderer.root.findByProps({ className: 'TimeText' }).props.title).toBe(
      'Oct 2, 2026, 14:00'
    );
    expect(renderer.root.findByType('button').props['aria-label']).toContain(
      'Last activity Oct 2, 2026, 14:00'
    );
    renderer.unmount();
    relativeTime.value = '';
  });

  it('leaves the preview row to the preview and counts replies in the metadata row', () => {
    const renderer = create(
      <CompactThreadCard
        viewModel={makeViewModel({
          messageCount: 1234,
          messageCountLabel: '1,234 msgs',
          messageCountText: '1,234',
          tags: ['blog'],
        })}
        onClick={vi.fn()}
      />
    );
    const preview = renderer.root.findByProps({ className: 'MessagePreview' });
    const metadata = renderer.root.findByProps({ className: 'MetadataRow' });
    const replyCount = metadata.findByProps({ 'data-compact-card-reply-count': 'true' });

    expect(JSON.stringify(preview.findByProps({ className: 'MessageText' }).props.children)).toBe(
      JSON.stringify('Me: Pending reply body')
    );
    expect(preview.findAllByProps({ 'data-compact-card-reply-count': 'true' })).toHaveLength(0);
    expect(replyCount.props.title).toBe('1,234 msgs');
    expect(replyCount.props.children).toContain('1,234');
    expect(metadata.findByProps({ 'data-tag-pill': 'blog' })).toBeTruthy();
    expect(renderer.root.findByType('button').props['aria-label']).toContain('1,234 msgs');
    renderer.unmount();
  });

  it('shows no count on a thread without replies and the count on one with two', () => {
    const unanswered = create(
      <CompactThreadCard
        viewModel={makeViewModel({
          messageCount: 0,
          messageCountLabel: '0 replies',
          messageCountText: '0',
        })}
        onClick={vi.fn()}
      />
    );
    expect(
      unanswered.root.findAllByProps({ 'data-compact-card-reply-count': 'true' })
    ).toHaveLength(0);
    expect(unanswered.root.findByType('button').props['aria-label']).not.toContain('0 replies');
    unanswered.unmount();

    const answered = create(
      <CompactThreadCard
        viewModel={makeViewModel({
          messageCount: 2,
          messageCountLabel: '2 msgs',
          messageCountText: '2',
        })}
        onClick={vi.fn()}
      />
    );
    const replyCount = answered.root.findByProps({ 'data-compact-card-reply-count': 'true' });
    expect(replyCount.props.children).toContain('2');
    expect(replyCount.props.title).toBe('2 msgs');
    expect(answered.root.findByType('button').props['aria-label']).toContain('2 msgs');
    answered.unmount();
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
    const metadata = renderer.root.findByProps({ className: 'MetadataRow' });
    const resolverByline = metadata.findByProps({
      'data-compact-card-resolution-byline': 'true',
    });

    expect(
      resolverByline.findAll(
        (node) => node.type === 'span' && node.children.includes('Resolved by Alice')
      )
    ).toHaveLength(1);

    renderer.unmount();
  });

  it('leads a resolved title, and only a resolved one, with the check badge', () => {
    const badges = (isResolved: boolean) => {
      const renderer = create(
        <CompactThreadCard viewModel={makeViewModel({ isResolved })} onClick={vi.fn()} />
      );
      const title = renderer.root.findByProps({ className: 'TitleText' });
      const found = title.findAll(
        (node) => node.type === 'span' && node.props.className === 'ResolvedBadge'
      ).length;
      renderer.unmount();
      return found;
    };

    expect(badges(true)).toBe(1);
    expect(badges(false)).toBe(0);
  });
});
