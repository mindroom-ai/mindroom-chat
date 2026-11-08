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
vi.mock('../config/appUpdate', () => update);
const reports = vi.hoisted(() => ({ reportBoundaryError: vi.fn() }));
vi.mock('../bug-reports/error-reporting/errorReporting', () => reports);
vi.mock('../ui/glass/GlassPrimitives', () => ({
  Dialog: ({ children, role }: { children?: ReactNode; role?: string }) => (
    <div role={role}>{children}</div>
  ),
}));
vi.mock('../ui/splash/SplashScreen', () => ({
  SplashScreen: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

function Broken(): ReactNode {
  throw new TypeError("Cannot read properties of undefined (reading 'ComputerScreen')");
}

const MISSING_CHUNK =
  'Failed to fetch dynamically imported module: https://chat.example.org/assets/RoomCall-a1.js';

/** A page whose chunk a deployment removed, loaded with a plain `lazy`. */
function GoneAfterDeploy(): ReactNode {
  throw new TypeError(MISSING_CHUNK);
}

const renderBroken = (Failing: () => ReactNode = Broken) => {
  // React reports the caught error on the console; the screen is what is under test.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return render(
    <AppErrorBoundary>
      <p>the app</p>
      <Failing />
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
    reports.reportBoundaryError.mockClear();
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

  it('hands the error and its component stack to the error reports', () => {
    renderBroken();
    expect(reports.reportBoundaryError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'TypeError' }),
      expect.stringContaining('Broken')
    );
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

  it('says a new version is available for a file the server no longer has, before it answers', () => {
    renderBroken(GoneAfterDeploy);

    expect(screen.getByRole('alert').textContent).toContain(
      'A new version of MindRoom is available.'
    );
    expect(screen.getByText(/Reload to use it\./)).toBeTruthy();
    expect(screen.queryByText(/Couldn't reach the server/)).toBeNull();
    expect(screen.getByText(MISSING_CHUNK)).toBeTruthy();
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
