// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../components/app-error/AppErrorBoundary';
import { createRouter } from './Router';

// A route whose page fails to render (here the pairing page; in practice a part whose chunk a
// deployment removed, in Lane P code without a fallback) reaches the app's root error boundary
// instead of React Router's developer page.
vi.mock('../mindroom/local-mindroom/ConnectPage', () => ({
  ConnectPage: () => {
    throw new Error('the pairing page broke');
  },
}));
vi.mock('./auth/AuthLayout', () => ({ AuthLayout: () => null }));
vi.mock('./auth/login/Login', () => ({ Login: () => null }));
vi.mock('./auth/register/Register', () => ({ Register: () => null }));
vi.mock('./auth/reset-password/ResetPassword', () => ({ ResetPassword: () => null }));
vi.mock('./client/ClientRoot', () => ({ ClientRoot: () => null }));
vi.mock('../../appUpdate', () => ({
  getNewVersion: () => undefined,
  subscribeToNewVersion: () => () => undefined,
  checkForNewVersion: vi.fn(async () => undefined),
  reloadForNewVersion: vi.fn(async () => undefined),
}));
vi.mock('../components/glass/GlassPrimitives', () => ({
  Dialog: ({ children, role }: { children?: ReactNode; role?: string }) => (
    <div role={role}>{children}</div>
  ),
}));
vi.mock('../components/splash-screen', () => ({
  SplashScreen: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../mindroom/notices/NoticeBanners.css', () => ({}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('route errors', () => {
  it("go to the app's root error boundary, with Reload", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/connect/');
    const router = createRouter({});

    render(
      <AppErrorBoundary>
        <RouterProvider router={router} />
      </AppErrorBoundary>
    );
    await act(async () => undefined);

    expect(screen.getByRole('alert').textContent).toContain('Something went wrong.');
    expect(screen.getByText(/the pairing page broke/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.queryByText('Unexpected Application Error!')).toBeNull();
    router.dispose();
  });
});
