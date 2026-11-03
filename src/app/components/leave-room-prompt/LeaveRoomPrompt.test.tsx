// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaveRoomPrompt } from './LeaveRoomPrompt';

const leave = vi.fn();
vi.mock('../../hooks/useMatrixClient', () => ({ useMatrixClient: () => ({ leave }) }));
// jsdom has no layout, so focus-trap finds nothing tabbable; the trap itself is not under test.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

describe('LeaveRoomPrompt', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    leave.mockReset();
  });

  const show = (onLeft = vi.fn(), requestClose = vi.fn()) => {
    act(() =>
      root.render(<LeaveRoomPrompt roomId="!r:test" onLeft={onLeft} requestClose={requestClose} />)
    );
    const leaveButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Leave'
    );
    return { onLeft, requestClose, leaveButton: leaveButton! };
  };

  it('leaves the room and reports it once the server confirmed', async () => {
    leave.mockResolvedValue({});
    const { onLeft, leaveButton } = show();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      'Are you sure you want to leave this room?'
    );

    await act(async () => leaveButton.click());

    expect(leave).toHaveBeenCalledWith('!r:test');
    expect(onLeft).toHaveBeenCalledOnce();
  });

  it('keeps the prompt open with the reason when leaving fails', async () => {
    leave.mockRejectedValue(new Error('M_FORBIDDEN'));
    const { onLeft, leaveButton } = show();

    await act(async () => leaveButton.click());

    expect(onLeft).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Failed to leave room! M_FORBIDDEN'
    );
    expect(leaveButton.disabled).toBe(false);
  });

  it('closes from its close button without leaving', () => {
    const { requestClose } = show();
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click());
    expect(requestClose).toHaveBeenCalledOnce();
    expect(leave).not.toHaveBeenCalled();
  });
});
