// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ComposerExpansionInputs,
  PRESS_SETTLE_MS,
  isComposerExpanded,
  useComposerFocus,
} from './composerExpansion';

const atRest: ComposerExpansionInputs = {
  phone: true,
  focused: false,
  pressing: false,
  empty: true,
  busy: false,
};

describe('isComposerExpanded', () => {
  it('always shows two rows off a phone', () => {
    expect(isComposerExpanded({ ...atRest, phone: false })).toBe(true);
  });

  it('shows one row on a phone at rest', () => {
    expect(isComposerExpanded(atRest)).toBe(false);
  });

  it.each([
    ['focus', { focused: true }],
    ['text', { empty: false }],
    ['files, a reply, a recording, a board or suggestions', { busy: true }],
  ] as const)('expands on a phone with %s', (_name, change) => {
    expect(isComposerExpanded({ ...atRest, ...change })).toBe(true);
  });

  it('stays expanded through a press until it settles', () => {
    expect(isComposerExpanded({ ...atRest, pressing: true })).toBe(true);
  });
});

function Probe() {
  const { focused, pressing, handlers } = useComposerFocus();
  return (
    <div data-testid="box" {...handlers}>
      <input data-testid="text" />
      <button type="button" data-testid="button">
        b
      </button>
      <output data-testid="state">{`${focused}|${pressing}`}</output>
    </div>
  );
}

describe('useComposerFocus', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps focus while it moves between parts and drops it once it leaves', () => {
    vi.useFakeTimers();
    render(
      <>
        <Probe />
        <input data-testid="outside" />
      </>
    );
    act(() => screen.getByTestId('text').focus());
    expect(screen.getByTestId('state').textContent).toBe('true|false');

    act(() => {
      screen.getByTestId('button').focus();
      vi.runOnlyPendingTimers();
    });
    expect(screen.getByTestId('state').textContent).toBe('true|false');

    act(() => {
      screen.getByTestId('outside').focus();
      vi.runOnlyPendingTimers();
    });
    expect(screen.getByTestId('state').textContent).toBe('false|false');
  });

  it('counts a press until it settles after the pointer lifts', () => {
    vi.useFakeTimers();
    render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId('button'));
    expect(screen.getByTestId('state').textContent).toBe('false|true');

    act(() => {
      vi.advanceTimersByTime(PRESS_SETTLE_MS * 3);
    });
    // Still down: the press lasts as long as the finger does.
    expect(screen.getByTestId('state').textContent).toBe('false|true');

    fireEvent.pointerUp(window);
    act(() => {
      vi.advanceTimersByTime(PRESS_SETTLE_MS - 1);
    });
    expect(screen.getByTestId('state').textContent).toBe('false|true');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('state').textContent).toBe('false|false');
  });

  it('ends a press on pointercancel too', () => {
    vi.useFakeTimers();
    render(<Probe />);
    fireEvent.pointerDown(screen.getByTestId('button'));
    fireEvent.pointerCancel(window);
    act(() => {
      vi.advanceTimersByTime(PRESS_SETTLE_MS);
    });
    expect(screen.getByTestId('state').textContent).toBe('false|false');
  });
});
