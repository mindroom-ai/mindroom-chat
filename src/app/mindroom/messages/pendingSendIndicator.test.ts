import React from 'react';
import { create } from 'react-test-renderer';
import { EventStatus } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { PendingSendIndicator } from './pendingSendIndicator';
import { isPendingLocalEchoEvent, isPendingLocalEchoStatus } from './pendingLocalEcho';

vi.mock('./PendingSendIndicator.css', () => ({
  Container: 'PendingSendIndicator',
}));

describe('pending send indicator', () => {
  it.each([EventStatus.ENCRYPTING, EventStatus.SENDING, EventStatus.QUEUED, EventStatus.SENT])(
    'treats %s as pending',
    (status) => {
      expect(isPendingLocalEchoStatus(status)).toBe(true);
    }
  );

  it.each([undefined, null, EventStatus.NOT_SENT, EventStatus.CANCELLED])(
    'does not treat %s as pending',
    (status) => {
      expect(isPendingLocalEchoStatus(status)).toBe(false);
    }
  );

  it('derives pending state from nullable Matrix events', () => {
    expect(isPendingLocalEchoEvent({ status: EventStatus.SENDING })).toBe(true);
    expect(isPendingLocalEchoEvent({ status: EventStatus.NOT_SENT })).toBe(false);
    expect(isPendingLocalEchoEvent(null)).toBe(false);
    expect(isPendingLocalEchoEvent(undefined)).toBe(false);
  });

  it('renders an accessible muted clock indicator', () => {
    const renderer = create(React.createElement(PendingSendIndicator));
    const rendered = JSON.stringify(renderer.toJSON());

    expect(rendered).toContain('Message sending');
    expect(rendered).toContain('Waiting for server');
    expect(rendered).toContain('Clock');

    renderer.unmount();
  });
});
