import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientLayout } from './ClientLayout';
import { useActiveSession } from '../../hooks/useSessionStore';
import { updateSessionLastPath } from '../../state/sessions';

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    Box: ({ children }: { children: React.ReactNode }) => reactModule.createElement('div', null, children),
  };
});

vi.mock('react-router-dom', () => ({
  useLocation: vi.fn(),
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: vi.fn(),
}));

vi.mock('../../state/sessions', () => ({
  updateSessionLastPath: vi.fn(),
}));

describe('ClientLayout', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('persists the exact active-session route including search and hash', async () => {
    const { useLocation } = await import('react-router-dom');

    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE',
      accessToken: 'token',
      lastUsedAt: 1,
    });
    vi.mocked(useLocation).mockReturnValue({
      pathname: '/space/%23lobby%3Amindroom.chat',
      search: '?threadId=%24abc',
      hash: '#reply',
    } as ReturnType<typeof useLocation>);

    await act(async () => {
      create(
        React.createElement(
          ClientLayout,
          {
            nav: React.createElement('div', null, 'nav'),
          },
          React.createElement('div', null, 'content')
        )
      )
    });

    expect(vi.mocked(updateSessionLastPath)).toHaveBeenCalledWith(
      'session-a',
      '/space/%23lobby%3Amindroom.chat?threadId=%24abc#reply'
    );
  });

  it('does nothing when there is no active session', async () => {
    const { useLocation } = await import('react-router-dom');

    vi.mocked(useActiveSession).mockReturnValue(undefined);
    vi.mocked(useLocation).mockReturnValue({
      pathname: '/home/',
      search: '',
      hash: '',
    } as ReturnType<typeof useLocation>);

    await act(async () => {
      create(
        React.createElement(
          ClientLayout,
          {
            nav: React.createElement('div', null, 'nav'),
          },
          React.createElement('div', null, 'content')
        )
      )
    });

    expect(vi.mocked(updateSessionLastPath)).not.toHaveBeenCalled();
  });
});
