// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { LeaveRoomPrompt } from './LeaveRoomPrompt';

const leave = vi.fn();
const forget = vi.fn();
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({ leave, forget }) }));
// jsdom has no layout, so focus-trap finds nothing tabbable; the trap itself is not under test.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

describe('LeaveRoomPrompt', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    leave.mockReset();
    forget.mockReset();
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

  it('leaves without forgetting unless asked, and forgets after leaving when asked', async () => {
    leave.mockResolvedValue({});
    forget.mockResolvedValue({});
    const first = show();
    await act(async () => first.leaveButton.click());
    expect(forget).not.toHaveBeenCalled();

    act(() => root.render(<span />));
    const second = show();
    act(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="Forget this room"]')?.click()
    );
    await act(async () => second.leaveButton.click());

    expect(forget).toHaveBeenCalledWith('!r:test');
    expect(second.onLeft).toHaveBeenCalledOnce();
  });

  it('keeps the prompt open with the reason, translated, when leaving fails', async () => {
    leave.mockRejectedValue(
      new MatrixError({ errcode: 'M_FORBIDDEN', error: 'You are not in this room.' }, 403)
    );
    const { onLeft, leaveButton } = show();

    await act(async () => leaveButton.click());

    expect(onLeft).not.toHaveBeenCalled();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.firstChild?.textContent).toBe(
      "Failed to leave room! You don't have permission to do this."
    );
    expect(alert?.querySelector('bdi')?.textContent).toBe(
      'M_FORBIDDEN: You are not in this room.'
    );
    expect(leaveButton.disabled).toBe(false);
  });

  it("names no reason it cannot translate, and keeps the error's own text beside it", async () => {
    leave.mockRejectedValue(new Error('Olm machine not ready'));
    const { leaveButton } = show();

    await act(async () => leaveButton.click());

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.firstChild?.textContent?.trim()).toBe('Failed to leave room!');
    expect(alert?.querySelector('bdi')?.textContent).toBe('Olm machine not ready');
  });

  it('closes from its close button without leaving', () => {
    const { requestClose } = show();
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click());
    expect(requestClose).toHaveBeenCalledOnce();
    expect(leave).not.toHaveBeenCalled();
  });
});
