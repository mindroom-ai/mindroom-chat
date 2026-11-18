// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEBUG_MODE_KEY, setDebugModeEnabled } from '../diagnostics/debugMode';
import { ComposerAttachButton } from './ComposerAttachButton';

// jsdom lays nothing out, so the trap would find no control to hold.
vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

// Debug mode's recorders are not under test here.
vi.mock('../diagnostics/flightRecorder', () => ({
  FLIGHT_RECORDER_CURRENT_KEY: 'mindroom.flight.current.v1',
  FLIGHT_RECORDER_ABNORMAL_KEY: 'mindroom.flight.abnormal.v1',
  installFlightRecorder: () => () => undefined,
}));
vi.mock('../diagnostics/deepTrace', () => ({
  initializeDeepTraceRecorder: vi.fn(),
  setDeepTraceEnabled: vi.fn(async () => true),
  clearDeepTrace: vi.fn(async () => undefined),
}));
vi.mock('../diagnostics/memorySampler', () => ({ startMemorySampler: vi.fn() }));

const onAttach = vi.fn();
const onAttachAppLogs = vi.fn();

const renderButton = () =>
  render(<ComposerAttachButton onAttach={onAttach} onAttachAppLogs={onAttachAppLogs} />);

describe('the wide composer plus button', () => {
  beforeEach(() => {
    onAttach.mockClear();
    onAttachAppLogs.mockClear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(DEBUG_MODE_KEY);
  });

  it('opens the file picker at once while debug mode is off', () => {
    renderButton();
    const button = screen.getByRole('button', { name: 'Attach files' });
    expect(button.getAttribute('aria-haspopup')).toBeNull();

    fireEvent.click(button);

    expect(onAttach).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu with Attach files and Attach app logs while debug mode is on', () => {
    window.localStorage.setItem(DEBUG_MODE_KEY, '1');
    renderButton();
    const button = screen.getByRole('button', { name: 'Attach' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');

    fireEvent.click(button);
    expect(onAttach).not.toHaveBeenCalled();
    expect(screen.getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual([
      'Attach files',
      'Attach app logs',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Attach app logs' }));
    expect(onAttachAppLogs).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Attach files' }));
    expect(onAttach).toHaveBeenCalledOnce();
  });

  it('follows debug mode as it changes in Settings', async () => {
    renderButton();
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeDefined();

    await act(async () => {
      await setDebugModeEnabled(true);
    });
    expect(screen.getByRole('button', { name: 'Attach' }).getAttribute('aria-haspopup')).toBe(
      'menu'
    );

    await act(async () => {
      await setDebugModeEnabled(false);
    });
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeDefined();
  });
});
