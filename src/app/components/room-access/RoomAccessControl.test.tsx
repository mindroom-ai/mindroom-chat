// @vitest-environment jsdom

import React from 'react';
import { JoinRule, type MatrixClient } from 'matrix-js-sdk';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MatrixClientProvider } from '../../hooks/useMatrixClient';
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

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children,
}));

const mx = {
  getRoom: vi.fn(() => null),
  joinRoom: vi.fn(async () => ({})),
  knockRoom: vi.fn(async () => ({ room_id: '!private:example.org' })),
  on: vi.fn(),
  removeListener: vi.fn(),
} as unknown as MatrixClient;

const getButton = (container: HTMLElement, label: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === label
  );
  if (!button) throw new Error(`Missing ${label} button`);
  return button;
};

describe('RoomAccessControl request dialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
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
        </MatrixClientProvider>
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not submit when the user cancels', () => {
    act(() => getButton(container, 'Request to join').click());

    act(() => getButton(container, 'Cancel').click());

    expect(mx.knockRoom).not.toHaveBeenCalled();
    expect(container.querySelector('form')).toBeNull();
  });

  it('exposes a named modal, an associated message label, and announced errors', async () => {
    vi.mocked(mx.knockRoom).mockRejectedValueOnce(new Error('Requests are paused'));
    act(() => getButton(container, 'Request to join').click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.tabIndex).toBe(-1);
    const titleId = dialog?.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId!)?.textContent).toBe('Request to join Private room');

    const message = container.querySelector<HTMLTextAreaElement>('textarea[name="reasonInput"]');
    expect(message).not.toBeNull();
    expect(message?.labels?.[0]?.textContent).toBe('Message (optional)');

    await act(async () => {
      container.querySelector('form')?.requestSubmit();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Requests are paused');
  });
});
