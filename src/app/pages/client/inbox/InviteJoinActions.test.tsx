import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Spinner } from 'folds';
import { MatrixError } from 'matrix-js-sdk';

import { AsyncStatus } from '../../../hooks/useAsyncCallback';
import { JoinRoomTimeoutError } from '../../../utils/joinRoom';
import { InviteJoinActions } from './InviteJoinActions';

describe('InviteJoinActions', () => {
  it('keeps invite actions disabled after a join timeout without showing a busy spinner', () => {
    const renderer = create(
      <InviteJoinActions
        joinState={{ status: AsyncStatus.Error, error: new JoinRoomTimeoutError() }}
        leaveState={{ status: AsyncStatus.Idle }}
        onJoin={vi.fn()}
        onLeave={vi.fn()}
      />
    );
    const buttons = renderer.root.findAllByType('button');

    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.props.disabled === true)).toBe(true);
    expect(renderer.root.findAllByType(Spinner)).toHaveLength(0);
  });

  it('re-enables invite actions after a settled server rejection', () => {
    const renderer = create(
      <InviteJoinActions
        joinState={{
          status: AsyncStatus.Error,
          error: new MatrixError({
            errcode: 'M_FORBIDDEN',
            error: 'You are not invited to this room.',
          }),
        }}
        leaveState={{ status: AsyncStatus.Idle }}
        onJoin={vi.fn()}
        onLeave={vi.fn()}
      />
    );

    expect(
      renderer.root.findAllByType('button').every((button) => button.props.disabled === false)
    ).toBe(true);
  });
});
