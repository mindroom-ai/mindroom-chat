import React from 'react';
import { create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { ConnectionError } from 'matrix-js-sdk/lib/http-api/errors';

import { JoinRoomErrorPrompt } from './JoinRoomErrorPrompt';

describe('JoinRoomErrorPrompt', () => {
  it('offers a reload when a browser-level network failure can require session recovery', () => {
    const onReload = vi.fn();
    const renderer = create(
      <JoinRoomErrorPrompt error={new ConnectionError('fetch failed')} onReload={onReload} />
    );
    const reload = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Reload app'
    );

    reload.props.onClick();

    expect(JSON.stringify(renderer.toJSON())).toContain('Reload the app to restore the connection');
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('keeps server rejections actionable without suggesting a reload', () => {
    const renderer = create(
      <JoinRoomErrorPrompt
        error={
          new MatrixError({
            errcode: 'M_FORBIDDEN',
            error: 'You are not invited to this room.',
          })
        }
      />
    );

    expect(JSON.stringify(renderer.toJSON())).toContain('You are not invited to this room.');
    expect(
      renderer.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Reload app'
      )
    ).toHaveLength(0);
  });
});
