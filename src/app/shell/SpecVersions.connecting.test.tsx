import { type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Spinner } from 'folds';
import { SpecVersions } from './SpecVersions';

// The connecting splash with the real branded splash: one spinner and one line on the screen.
vi.mock('folds', async (original) => ({
  ...(await original<typeof import('folds')>()),
  Box: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Spinner: () => <div />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock('../ui/splash/SplashScreen', () => ({
  SplashScreen: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));
vi.mock('../matrix/SpecVersionsLoader', () => ({
  SpecVersionsLoader: ({ fallback }: { fallback: () => ReactNode }) => fallback(),
}));
vi.mock('../matrix/cachedSpecVersions', () => ({
  readCachedSpecVersions: () => undefined,
  writeCachedSpecVersions: vi.fn(),
}));
vi.mock('../matrix/cs-api', () => ({ specVersions: vi.fn() }));
vi.mock('../account/lifecycle/sessionLifecycle', () => ({
  clearAllCacheAndReload: vi.fn(),
  removeSessionAndReload: vi.fn(),
}));
vi.mock('../matrix/session/useSessionStore', () => ({
  useActiveSession: () => ({
    sessionId: 'session-a',
    baseUrl: 'https://matrix.example.org',
    userId: '@alice:example.org',
    deviceId: 'DEVICE',
    accessToken: 'token',
    lastUsedAt: 1,
  }),
}));

const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType('span').map((node) => node.children.join(''));

describe('SpecVersions while connecting', () => {
  it('shows one spinner over the connecting line, then the way back to sign in', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<SpecVersions baseUrl="https://matrix.example.org">app</SpecVersions>);
    });
    if (!renderer) throw new Error('not rendered');

    expect(renderer.root.findAllByType(Spinner)).toHaveLength(1);
    expect(texts(renderer)).toEqual(['Connecting to server', 'Cancel and return to sign in']);
  });
});
