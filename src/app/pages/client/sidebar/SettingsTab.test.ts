import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHomePath, getLoginPath } from '../../pathUtils';
import { SettingsTab } from './SettingsTab';
import { useActiveSession, useStoredSessions } from '../../../hooks/useSessionStore';
import { setActiveSession, updateSessionProfile } from '../../../state/sessions';
import { withAddAccountSearch } from '../../auth/addAccount';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { mxcUrlToHttp } from '../../../utils/matrix';

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

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock('../../../components/sidebar', () => ({
  SidebarItem: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  SidebarItemTooltip: ({
    children,
  }: {
    children: (triggerRef: () => void) => React.ReactNode;
  }) => React.createElement('div', null, children(() => undefined)),
  SidebarAvatar: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      children: React.ReactNode;
    }
  >(({ children, ...props }, ref) =>
    React.createElement('button', { ref, type: 'button', ...props }, children)
  ),
}));

vi.mock('../../../components/user-avatar', () => ({
  UserAvatar: ({ userId, src }: { userId: string; src?: string }) =>
    React.createElement('div', { 'data-user-id': userId, 'data-src': src }, userId),
}));

vi.mock('../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    getUserId: () => '@alice:mindroom.chat',
    getHomeserverUrl: () => 'https://mindroom.chat',
  }),
}));

vi.mock('../../../utils/matrix', () => ({
  getMxIdLocalPart: (userId: string) => userId.split(':')[0].replace('@', ''),
  mxcUrlToHttp: vi.fn(() => undefined),
}));

vi.mock('../../../utils/common', () => ({
  nameInitials: (name: string) => name.slice(0, 1),
}));

vi.mock('../../../hooks/useMediaAuthentication', () => ({
  useMediaAuthentication: () => false,
}));

vi.mock('../../../features/settings', () => ({
  Settings: () => React.createElement('div', { 'data-testid': 'settings-modal' }, 'settings'),
}));

vi.mock('../../../hooks/useUserProfile', () => ({
  useUserProfile: vi.fn(() => ({
    displayName: 'Alice',
    avatarUrl: undefined,
  })),
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

vi.mock('./AccountSwitcher', () => ({
  AccountSwitcher: () =>
    React.createElement('div', { 'data-testid': 'account-switcher' }, 'account-switcher'),
}));

const activeSession = {
  sessionId: 'session-a',
  baseUrl: 'https://chat.mindroom.chat',
  userId: '@alice:mindroom.chat',
  deviceId: 'DEVICE_A',
  accessToken: 'token-a',
  lastUsedAt: 1,
};

const inactiveSession = {
  sessionId: 'session-b',
  baseUrl: 'https://matrix.org',
  userId: '@bob:matrix.org',
  deviceId: 'DEVICE_B',
  accessToken: 'token-b',
  lastUsedAt: 2,
  lastKnownDisplayName: 'Bob',
  lastKnownPath: '/space/%23lobby%3Amindroom.chat?threadId=%24abc#reply',
};

const findButtonByAriaLabel = (renderer: ReturnType<typeof create>, label: string) =>
  renderer.root.findAll(
    (node) => node.type === 'button' && node.props['aria-label'] === label
  )[0];

const findByTestId = (renderer: ReturnType<typeof create>, testId: string) =>
  renderer.root.findAll((node) => node.props['data-testid'] === testId)[0];

const renderSettingsTab = (sessions = [activeSession, inactiveSession]) => {
  vi.mocked(useActiveSession).mockReturnValue(activeSession);
  vi.mocked(useStoredSessions).mockReturnValue(sessions);

  return create(React.createElement(SettingsTab));
};

describe('SettingsTab', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    navigate.mockReset();
  });

  it('opens settings from the active avatar instead of the account switcher', async () => {
    const renderer = renderSettingsTab();

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Open settings for Alice').props.onClick();
    });

    expect(findByTestId(renderer, 'settings-modal')).toBeDefined();
    expect(findByTestId(renderer, 'account-switcher')).toBeUndefined();
    expect(vi.mocked(setActiveSession)).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the manage accounts trigger only when multiple sessions exist', () => {
    const multiSessionRenderer = renderSettingsTab();
    expect(findButtonByAriaLabel(multiSessionRenderer, 'Manage accounts')).toBeDefined();

    const singleSessionRenderer = renderSettingsTab([activeSession]);
    expect(findButtonByAriaLabel(singleSessionRenderer, 'Manage accounts')).toBeUndefined();
  });

  it('opens the account switcher from the manage accounts trigger', async () => {
    const renderer = renderSettingsTab();

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Manage accounts').props.onClick();
    });

    expect(findByTestId(renderer, 'account-switcher')).toBeDefined();
    expect(findByTestId(renderer, 'settings-modal')).toBeUndefined();
  });

  it('restores the stored last route when switching to another account', async () => {
    const renderer = renderSettingsTab();

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Switch to account Bob (@bob:matrix.org)').props.onClick();
    });

    expect(vi.mocked(setActiveSession)).toHaveBeenCalledWith('session-b');
    expect(navigate).toHaveBeenCalledWith('/space/%23lobby%3Amindroom.chat?threadId=%24abc#reply');
  });

  it('falls back to home when the stored path is missing or invalid', async () => {
    const renderer = renderSettingsTab([{ ...activeSession }, { ...inactiveSession, lastKnownPath: 'https://matrix.org/outside' }]);

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Switch to account Bob (@bob:matrix.org)').props.onClick();
    });

    expect(vi.mocked(setActiveSession)).toHaveBeenCalledWith('session-b');
    expect(navigate).toHaveBeenCalledWith(getHomePath());
    expect(vi.mocked(updateSessionProfile)).toHaveBeenCalled();
  });

  it('preserves the active homeserver when opening add account', async () => {
    const localSession = {
      ...activeSession,
      baseUrl: 'http://127.0.0.1:8808',
      userId: '@alice:mindroom.local',
    };
    vi.mocked(useActiveSession).mockReturnValue(localSession);
    vi.mocked(useStoredSessions).mockReturnValue([localSession]);

    const renderer = create(React.createElement(SettingsTab));

    await act(async () => {
      findButtonByAriaLabel(renderer, 'Add account').props.onClick();
    });

    expect(navigate).toHaveBeenCalledWith(
      withAddAccountSearch(getLoginPath('http://127.0.0.1:8808'))
    );
  });

  it('does not refetch the active avatar when the cached avatar data already matches', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: 'mxc://mindroom.chat/avatar',
    });
    vi.mocked(mxcUrlToHttp).mockReturnValue('https://cdn.mindroom.chat/avatar.png');

    const sessionWithCachedAvatar = {
      ...activeSession,
      lastKnownAvatarUrl: 'mxc://mindroom.chat/avatar',
      lastKnownAvatarDataUrl: 'data:image/png;base64,cached',
    };

    vi.mocked(useActiveSession).mockReturnValue(sessionWithCachedAvatar);
    vi.mocked(useStoredSessions).mockReturnValue([sessionWithCachedAvatar]);

    await act(async () => {
      create(React.createElement(SettingsTab));
      await Promise.resolve();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses cached avatar data for the active account when the live profile avatar is unavailable', async () => {
    const sessionWithCachedAvatar = {
      ...activeSession,
      lastKnownAvatarUrl: 'mxc://mindroom.chat/avatar',
      lastKnownAvatarDataUrl: 'data:image/png;base64,cached',
    };

    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: undefined,
    });
    vi.mocked(useActiveSession).mockReturnValue(sessionWithCachedAvatar);
    vi.mocked(useStoredSessions).mockReturnValue([sessionWithCachedAvatar]);

    const renderer = create(React.createElement(SettingsTab));
    const activeAvatar = renderer.root.findAll(
      (node) => node.props['data-user-id'] === '@alice:mindroom.chat'
    )[0];

    expect(activeAvatar.props['data-src']).toBe('data:image/png;base64,cached');
  });

  it('fetches the last known avatar url when the live profile avatar is unavailable', async () => {
    class FileReaderMock {
      result: string | null = null;

      onload: null | (() => void) = null;

      onerror: null | (() => void) = null;

      readAsDataURL() {
        this.result = 'data:image/png;base64,avatar';
        this.onload?.();
      }
    }

    vi.stubGlobal('FileReader', FileReaderMock);
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['avatar'], { type: 'image/png' })),
      })
    );
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: undefined,
    });
    vi.mocked(mxcUrlToHttp).mockReturnValue('https://cdn.mindroom.chat/avatar.png');

    const sessionWithLastKnownAvatar = {
      ...activeSession,
      lastKnownAvatarUrl: 'mxc://mindroom.chat/avatar',
      lastKnownAvatarDataUrl: undefined,
    };

    vi.mocked(useActiveSession).mockReturnValue(sessionWithLastKnownAvatar);
    vi.mocked(useStoredSessions).mockReturnValue([sessionWithLastKnownAvatar]);

    await act(async () => {
      create(React.createElement(SettingsTab));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/mindroom.chat/avatar?width=96&height=96&method=crop&allow_redirect=true&access_token=token-a',
      expect.any(Object)
    );
  });

  it('derives an active avatar src from the last known mxc url when mxcUrlToHttp is unavailable', () => {
    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: undefined,
    });
    vi.mocked(mxcUrlToHttp).mockReturnValue(undefined);

    const sessionWithLastKnownAvatar = {
      ...activeSession,
      lastKnownAvatarUrl: 'mxc://mindroom.chat/avatar-media-id',
      lastKnownAvatarDataUrl: undefined,
    };

    vi.mocked(useActiveSession).mockReturnValue(sessionWithLastKnownAvatar);
    vi.mocked(useStoredSessions).mockReturnValue([sessionWithLastKnownAvatar]);

    const renderer = create(React.createElement(SettingsTab));
    const activeAvatar = renderer.root.findAll(
      (node) => node.props['data-user-id'] === '@alice:mindroom.chat'
    )[0];

    expect(activeAvatar.props['data-src']).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/mindroom.chat/avatar-media-id?width=96&height=96&method=crop&allow_redirect=true&access_token=token-a'
    );
  });

  it('prefers the stored-session copy of the active avatar fields when the active-session hook is stale', () => {
    vi.mocked(useUserProfile).mockReturnValue({
      displayName: 'Alice',
      avatarUrl: undefined,
    });
    vi.mocked(mxcUrlToHttp).mockReturnValue(undefined);

    const staleActiveSession = {
      ...activeSession,
      lastKnownAvatarUrl: undefined,
      lastKnownAvatarDataUrl: undefined,
    };
    const refreshedSession = {
      ...activeSession,
      lastKnownAvatarUrl: 'mxc://mindroom.chat/avatar-media-id',
      lastKnownAvatarDataUrl: undefined,
    };

    vi.mocked(useActiveSession).mockReturnValue(staleActiveSession);
    vi.mocked(useStoredSessions).mockReturnValue([refreshedSession]);

    const renderer = create(React.createElement(SettingsTab));
    const activeAvatar = renderer.root.findAll(
      (node) => node.props['data-user-id'] === '@alice:mindroom.chat'
    )[0];

    expect(activeAvatar.props['data-src']).toBe(
      'https://mindroom.chat/_matrix/client/v1/media/thumbnail/mindroom.chat/avatar-media-id?width=96&height=96&method=crop&allow_redirect=true&access_token=token-a'
    );
  });
});
