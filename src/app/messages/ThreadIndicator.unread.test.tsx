// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThreadIndicator, type ThreadIndicatorUnread } from './ThreadIndicator';
import { ThreadBadge } from '../timeline/ThreadBadge';
import * as css from './ThreadIndicator.css';

const room = {} as Room;

/** The chip, found by the name a screen reader gives it, and its classes. */
const renderChip = (
  name: string,
  props: { unread?: ThreadIndicatorUnread; isResolved?: boolean }
): string[] => {
  render(
    <ThreadIndicator
      as="button"
      room={room}
      threadRootId="$root"
      threadReplyCount={11}
      {...props}
    />
  );
  return [...screen.getByRole('button', { name }).classList];
};

describe('ThreadIndicator while its thread is unread', () => {
  afterEach(cleanup);

  it('is the plain reply chip while the thread is read', () => {
    const classes = renderChip('Thread 11 replies', {});

    expect(classes).toEqual([css.ThreadIndicator]);
    expect(screen.queryByRole('img', { name: 'Mentions you' })).toBeNull();
  });

  it.each(['Nightly backup check', '', undefined])(
    'renders a title only when present (%s)',
    (summaryText) => {
      render(
        <ThreadBadge
          room={room}
          onClick={() => {}}
          model={{
            id: { roomId: '!room:example.org', threadRootId: '$root' },
            summaryInfo: summaryText === undefined ? undefined : { summaryText, messageCount: 3 },
            recentThreadSummaryText: '',
            replyCount: 11,
            participantIds: [],
            isResolved: false,
            isUnread: true,
          }}
        />
      );
      const button = screen.getByRole('button', {
        name: summaryText
          ? 'Thread Nightly backup check New · 11 replies'
          : 'Thread New · 11 replies',
        description: summaryText ? 'AI summary of last 3 messages' : '',
      });
      expect(button.textContent).toBe(
        summaryText ? 'Nightly backup check New · 11 replies' : 'New · 11 replies'
      );
      expect(button.hasAttribute('aria-describedby')).toBe(Boolean(summaryText));
    }
  );

  it('reads New and takes the accent', () => {
    const classes = renderChip('Thread New · 11 replies', { unread: { mentionsMe: false } });

    expect(classes).toEqual([css.ThreadIndicator, css.ThreadIndicatorUnread]);
    expect(screen.queryByRole('img', { name: 'Mentions you' })).toBeNull();
  });

  it('adds an @ pill when a new reply names the user', () => {
    renderChip('Thread New · 11 replies Mentions you', { unread: { mentionsMe: true } });

    expect(screen.getByRole('img', { name: 'Mentions you' }).textContent).toBe('@');
  });

  it('keeps the resolved check, under the unread tint, while a resolved thread is unread', () => {
    const classes = renderChip('Thread New · 11 replies Resolved thread', {
      isResolved: true,
      unread: { mentionsMe: false },
    });

    expect(classes).toEqual([
      css.ThreadIndicator,
      css.ThreadIndicatorResolved,
      css.ThreadIndicatorUnread,
    ]);
  });
});
