// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThreadIndicator, type ThreadIndicatorUnread } from './ThreadIndicator';
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

    expect(classes).not.toContain(css.ThreadIndicatorUnread);
    expect(screen.queryByRole('img', { name: 'Mentions you' })).toBeNull();
  });

  it('says how many replies are new and takes the accent', () => {
    const classes = renderChip('Thread 4 new · 11 replies', {
      unread: { newCount: 4, mentionsMe: false },
    });

    expect(classes).toEqual([css.ThreadIndicator, css.ThreadIndicatorUnread]);
    expect(screen.queryByRole('img', { name: 'Mentions you' })).toBeNull();
  });

  it('reads New while the count of new replies is unknown', () => {
    renderChip('Thread New · 11 replies', { unread: { newCount: 0, mentionsMe: false } });
  });

  it('adds an @ pill when a new reply names the user', () => {
    renderChip('Thread 2 new · 11 replies Mentions you', {
      unread: { newCount: 2, mentionsMe: true },
    });

    expect(screen.getByRole('img', { name: 'Mentions you' }).textContent).toBe('@');
  });

  it('keeps the resolved check, under the unread tint, while a resolved thread is unread', () => {
    const classes = renderChip('Thread 1 new · 11 replies Resolved thread', {
      isResolved: true,
      unread: { newCount: 1, mentionsMe: false },
    });

    expect(classes).toEqual([
      css.ThreadIndicator,
      css.ThreadIndicatorResolved,
      css.ThreadIndicatorUnread,
    ]);
  });
});
