// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

const update = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state: { version: string | undefined } = { version: undefined };
  return {
    state,
    publish: (version: string) => {
      state.version = version;
      listeners.forEach((listener) => listener());
    },
    getNewVersion: () => state.version,
    subscribeToNewVersion: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    checkForNewVersion: vi.fn(async () => undefined),
    reloadForNewVersion: vi.fn(async () => undefined),
  };
});
vi.mock('../../../appUpdate', () => update);
vi.mock('../glass/GlassPrimitives', () => ({
  Dialog: ({ children, role }: { children?: ReactNode; role?: string }) => (
    <div role={role}>{children}</div>
  ),
}));
vi.mock('../splash-screen', () => ({
  SplashScreen: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../mindroom/notices/NoticeBanners.css', () => ({}));

function Broken(): ReactNode {
  throw new TypeError("Cannot read properties of undefined (reading 'ComputerScreen')");
}

const renderBroken = () => {
  // React reports the caught error on the console; the screen is what is under test.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return render(
    <AppErrorBoundary>
      <p>the app</p>
      <Broken />
    </AppErrorBoundary>
  );
};

describe('AppErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    update.state.version = undefined;
    update.checkForNewVersion.mockClear();
    update.reloadForNewVersion.mockClear();
  });

  it('shows what happened, the error text and Reload in place of a screen that failed', () => {
    renderBroken();

    expect(screen.queryByText('the app')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong.');
    expect(screen.getByText(/couldn't show this screen/)).toBeTruthy();
    expect(screen.getByText(/reading 'ComputerScreen'/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(update.reloadForNewVersion).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Reload' }).hasAttribute('disabled')).toBe(true);
  });

  it('asks the server for its version, and says when a new one is the cause', () => {
    renderBroken();
    expect(update.checkForNewVersion).toHaveBeenCalledOnce();

    act(() => update.publish('build-2'));

    expect(screen.getByRole('alert').textContent).toContain(
      'A new version of MindRoom is available.'
    );
    expect(screen.getByText(/Reload to use it\./)).toBeTruthy();
  });

  it('renders its children while nothing fails', () => {
    render(
      <AppErrorBoundary>
        <p>the app</p>
      </AppErrorBoundary>
    );
    expect(screen.getByText('the app')).toBeTruthy();
    expect(update.checkForNewVersion).not.toHaveBeenCalled();
  });
});
