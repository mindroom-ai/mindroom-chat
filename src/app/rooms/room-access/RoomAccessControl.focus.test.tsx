// @vitest-environment jsdom

import React from 'react';
import { JoinRule, type MatrixClient } from 'matrix-js-sdk';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { RoomAccessControl } from './RoomAccessControl';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('folds', async () => {
  const actual = await vi.importActual<typeof import('folds')>('folds');
  const Wrapper = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    ...actual,
    Overlay: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
      open ? children : null,
    OverlayBackdrop: Wrapper,
    OverlayCenter: Wrapper,
  };
});

const mx = {
  getRoom: vi.fn(() => null),
  getRooms: vi.fn(() => []),
  getUserId: vi.fn(() => '@me:example.org'),
  joinRoom: vi.fn(async () => ({})),
  knockRoom: vi.fn(async () => ({ room_id: '!private:example.org' })),
  on: vi.fn(),
  removeListener: vi.fn(),
} as unknown as MatrixClient;

const tab = (shiftKey = false) => {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

describe('RoomAccessControl request dialog focus', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <MatrixClientProvider value={mx}>
          <RoomAccessControl
            roomIdOrAlias="!private:example.org"
            roomName="Private room"
            joinRule={JoinRule.Knock}
          >
            {(access) => <button onClick={access.activate}>Request to join</button>}
          </RoomAccessControl>
          <button type="button">Outside</button>
        </MatrixClientProvider>
      );
    });
    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Request to join'
    );
    act(() => trigger?.click());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('wraps Tab and Shift+Tab inside the dialog', () => {
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const message = container.querySelector<HTMLTextAreaElement>('textarea[name="reasonInput"]');
    const buttons = Array.from(dialog?.querySelectorAll('button') ?? []);
    const last = buttons.at(-1);
    expect(document.activeElement).toBe(message);

    act(() => last?.focus());
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(message);

    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });
});
