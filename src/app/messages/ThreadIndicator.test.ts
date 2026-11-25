// @vitest-environment jsdom
import React from 'react';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MatrixClientProvider } from '../matrix/hooks/useMatrixClient';
import { ThreadIndicator } from './ThreadIndicator';
import { getThreadRootReplyCount } from './threadIndicatorViewModel';

const makeEvent = (threadMeta?: Record<string, unknown>) =>
  ({
    getUnsigned: () =>
      threadMeta
        ? {
            'm.relations': {
              'm.thread': threadMeta,
            },
          }
        : {},
  }) as never;

describe('getThreadRootReplyCount', () => {
  it('reads current Matrix thread count metadata', () => {
    expect(getThreadRootReplyCount(makeEvent({ count: 3 }))).toBe(3);
  });

  it('supports legacy short-count thread metadata', () => {
    expect(getThreadRootReplyCount(makeEvent({ c: 2 }))).toBe(2);
  });

  it('ignores missing or malformed thread metadata', () => {
    expect(getThreadRootReplyCount(makeEvent())).toBeUndefined();
    expect(getThreadRootReplyCount(makeEvent({ count: '3', c: null }))).toBeUndefined();
  });
});

describe('ThreadIndicator focus preservation', () => {
  afterEach(cleanup);

  it('preserves button identity and keyboard focus when the first participant arrives', () => {
    const alice = {
      name: 'Alice',
      rawDisplayName: 'Alice',
      getMxcAvatarUrl: () => null,
    };
    const room = {
      getMember: (userId: string) => (userId === '@alice:example.org' ? alice : null),
    } as unknown as Room;
    const mx = {} as MatrixClient;

    const wrap = (replyCount: number, participantIds: string[]) =>
      React.createElement(
        MatrixClientProvider,
        { value: mx },
        React.createElement(ThreadIndicator, {
          as: 'button',
          room,
          threadRootId: '$root',
          threadReplyCount: replyCount,
          threadParticipantIds: participantIds,
        })
      );

    const { rerender } = render(wrap(0, []));
    const button = screen.getByRole('button');
    button.focus();
    expect(document.activeElement).toBe(button);

    rerender(wrap(1, ['@alice:example.org']));

    const updatedButton = screen.getByRole('button');
    expect(updatedButton).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(updatedButton.querySelector('[title="Alice"]')).not.toBeNull();
  });
});
