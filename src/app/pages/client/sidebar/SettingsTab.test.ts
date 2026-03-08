import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHomePath } from '../../pathUtils';
import { SettingsTab } from './SettingsTab';
import { useActiveSession, useStoredSessions } from '../../../hooks/useSessionStore';
import { setActiveSession, updateSessionProfile } from '../../../state/sessions';

const navigate = vi.fn();

vi.mock('folds', async () => {
  const reactModule = await import('react');
  return {
    Icon: () => reactModule.createElement('i'),
    Icons: {
      Plus: 'Plus',
    },
    Text: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement('span', null, children),
  };
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('../../../components/sidebar', () => ({
  SidebarItem: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  SidebarItemTooltip: ({
    children,
  }: {
    children: (triggerRef: () => void) => React.ReactNode;
  }) => React.createElement('div', null, children(() => undefined)),
  SidebarAvatar: React.forwardRef<
    HTMLButtonElement,
    {
      children: React.ReactNode;
      onClick?: () => void;
    }
  >(({ children, onClick }, ref) =>
    React.createElement('button', { ref, onClick, type: 'button' }, children)
  ),
}));

vi.mock('../../../components/user-avatar', () => ({
  UserAvatar: ({ userId }: { userId: string }) => React.createElement('div', null, userId),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@alice:mindroom.chat',
  }),
}));

vi.mock('../../../utils/matrix', () => ({
  getMxIdLocalPart: (userId: string) => userId.split(':')[0].replace('@', ''),
  mxcUrlToHttp: () => undefined,
}));

vi.mock('../../../utils/common', () => ({
  nameInitials: (name: string) => name.slice(0, 1),
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../features/settings', () => ({
  Settings: () => React.createElement('div', null, 'settings'),
}));

vi.mock('../../../hooks/useUserProfile', () => ({
  useUserProfile: () => ({
    displayName: 'Alice',
    avatarUrl: undefined,
  }),
}));

vi.mock('../../../components/Modal500', () => ({
  Modal500: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('../../../hooks/useSessionStore', () => ({
  useActiveSession: vi.fn(),
  useStoredSessions: vi.fn(),
}));

vi.mock('../../../state/sessions', () => ({
  setActiveSession: vi.fn(),
  updateSessionProfile: vi.fn(),
}));

vi.mock('../../../../client/initMatrix', () => ({
  removeStoredSession: vi.fn().mockResolvedValue(undefined),
}));

describe('SettingsTab', () => {
  afterEach(() => {
    vi.clearAllMocks();
    navigate.mockReset();
  });

  it('restores the stored last route when switching to another account', async () => {
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    });
    vi.mocked(useStoredSessions).mockReturnValue([
      {
        sessionId: 'session-a',
        baseUrl: 'https://chat.mindroom.chat',
        userId: '@alice:mindroom.chat',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
        lastUsedAt: 1,
      },
      {
        sessionId: 'session-b',
        baseUrl: 'https://matrix.org',
        userId: '@bob:matrix.org',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
        lastUsedAt: 2,
        lastKnownPath: '/space/%23lobby%3Amindroom.chat?threadId=%24abc#reply',
      },
    ]);

    const renderer = create(React.createElement(SettingsTab));
    const buttons = renderer.root.findAllByType('button');

    await act(async () => {
      buttons[1].props.onClick();
    });

    expect(vi.mocked(setActiveSession)).toHaveBeenCalledWith('session-b');
    expect(navigate).toHaveBeenCalledWith('/space/%23lobby%3Amindroom.chat?threadId=%24abc#reply');
  });

  it('falls back to home when the stored path is missing or invalid', async () => {
    vi.mocked(useActiveSession).mockReturnValue({
      sessionId: 'session-a',
      baseUrl: 'https://chat.mindroom.chat',
      userId: '@alice:mindroom.chat',
      deviceId: 'DEVICE_A',
      accessToken: 'token-a',
      lastUsedAt: 1,
    });
    vi.mocked(useStoredSessions).mockReturnValue([
      {
        sessionId: 'session-a',
        baseUrl: 'https://chat.mindroom.chat',
        userId: '@alice:mindroom.chat',
        deviceId: 'DEVICE_A',
        accessToken: 'token-a',
        lastUsedAt: 1,
      },
      {
        sessionId: 'session-b',
        baseUrl: 'https://matrix.org',
        userId: '@bob:matrix.org',
        deviceId: 'DEVICE_B',
        accessToken: 'token-b',
        lastUsedAt: 2,
        lastKnownPath: 'https://matrix.org/outside',
      },
    ]);

    const renderer = create(React.createElement(SettingsTab));
    const buttons = renderer.root.findAllByType('button');

    await act(async () => {
      buttons[1].props.onClick();
    });

    expect(vi.mocked(setActiveSession)).toHaveBeenCalledWith('session-b');
    expect(navigate).toHaveBeenCalledWith(getHomePath());
    expect(vi.mocked(updateSessionProfile)).toHaveBeenCalled();
  });
});
