// @vitest-environment jsdom
import type { Room } from 'matrix-js-sdk';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
  let layoutStyle: HTMLStyleElement;
  beforeAll(() => {
    // Production flex/grid CSS blockifies icon items and folds Badge is inline-flex;
    // jsdom 31 defaults unstyled svg/span to inline when vanilla-extract CSS is absent.
    layoutStyle = document.createElement('style');
    layoutStyle.textContent = '[role="img"] { display: inline-block; }';
    document.head.appendChild(layoutStyle);
  });
  afterAll(() => {
    layoutStyle.remove();
  });
  afterEach(cleanup);

  it('is the plain reply chip while the thread is read', () => {
    const classes = renderChip('Thread 11 replies', {});

    expect(classes).toEqual([css.ThreadIndicator]);
    expect(screen.queryByRole('img', { name: 'Mentions you' })).toBeNull();
  });

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
