import React, { useEffect, useMemo, useState } from 'react';
import { Icon, Icons, Text } from 'folds';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { SidebarItem, SidebarItemTooltip, SidebarAvatar } from '../../../components/sidebar';
import { UserAvatar } from '../../../components/user-avatar';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { nameInitials } from '../../../utils/common';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { Modal500 } from '../../../components/Modal500';
import { useActiveSession, useStoredSessions } from '../../../hooks/useSessionStore';
import { setActiveSession, updateSessionProfile } from '../../../state/sessions';
import { settingsModalAtom } from '../../../state/settingsModal';
import { getLoginPath } from '../../pathUtils';
import { withAddAccountSearch } from '../../auth/addAccount';
import { removeStoredSession } from '../../../../client/initMatrix';
import { AccountSwitcher, AccountSwitcherItem } from './AccountSwitcher';
import { resolveSessionRestorePath } from '../sessionRouteRestore';

const buildStoredAvatarHttpUrl = (
  homeserverUrl: string,
  mxcUrl: string,
  width: number,
  height: number,
  accessToken?: string
): string | undefined => {
  const match = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/);
  if (!match) return undefined;

  try {
    const [, serverName, mediaId] = match;
    const homeserver = new URL(homeserverUrl);
    const basePath = homeserver.pathname.replace(/\/+$/, '');
    const mediaPath = `${basePath}/_matrix/client/v1/media/thumbnail/${serverName}/${mediaId}`.replace(
      /\/{2,}/g,
      '/'
    );
    homeserver.pathname = mediaPath;
    homeserver.search = '';
    homeserver.searchParams.set('width', String(width));
    homeserver.searchParams.set('height', String(height));
    homeserver.searchParams.set('method', 'crop');
    homeserver.searchParams.set('allow_redirect', 'true');
    if (accessToken) {
      homeserver.searchParams.set('access_token', accessToken);
    }
    return homeserver.toString();
  } catch {
    return undefined;
  }
};

const blobToDataUrl = async (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export function SettingsTab() {
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const rawActiveSession = useActiveSession();
  const sessions = useStoredSessions();
  const activeSession = useMemo(
    () =>
      sessions.find((session) => session.sessionId === rawActiveSession?.sessionId) ?? rawActiveSession,
    [rawActiveSession, sessions]
  );
  const userId = mx.getUserId() ?? activeSession?.userId ?? '';
  const profile = useUserProfile(userId);

  const [accountSwitcher, setAccountSwitcher] = useState(false);
  const [removingSessionId, setRemovingSessionId] = useState<string>();

  const displayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const activeSessionId = activeSession?.sessionId;
  const lastKnownAvatarUrl = activeSession?.lastKnownAvatarUrl;
  const lastKnownAvatarDataUrl = activeSession?.lastKnownAvatarDataUrl;
  const avatarUrl = profile.avatarUrl
    ? mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;
  const lastKnownAvatarHttpUrl =
    (lastKnownAvatarUrl
      ? buildStoredAvatarHttpUrl(
          mx.getHomeserverUrl(),
          lastKnownAvatarUrl,
          96,
          96,
          activeSession?.accessToken
        )
      : undefined) ??
    (lastKnownAvatarUrl
      ? mxcUrlToHttp(mx, lastKnownAvatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined
      : undefined);
  const activeAvatarSrc = lastKnownAvatarDataUrl ?? lastKnownAvatarHttpUrl ?? avatarUrl;

  useEffect(() => {
    if (!activeSessionId) return;

    updateSessionProfile(activeSessionId, {
      lastKnownDisplayName: displayName,
      lastKnownAvatarUrl: profile.avatarUrl ?? undefined,
    });
  }, [activeSessionId, displayName, profile.avatarUrl]);

  useEffect(() => {
    if (!activeSessionId) return undefined;
    const avatarFetchUrl = avatarUrl ?? lastKnownAvatarHttpUrl;
    if (!avatarFetchUrl) {
      updateSessionProfile(activeSessionId, {
        lastKnownAvatarDataUrl: undefined,
      });
      return undefined;
    }
    if (profile.avatarUrl === lastKnownAvatarUrl && lastKnownAvatarDataUrl) {
      return undefined;
    }

    const abortController = new AbortController();

    fetch(avatarFetchUrl, { signal: abortController.signal })
      .then(async (response) => {
        if (!response.ok) return undefined;
        const blob = await response.blob();
        if (blob.size > 128 * 1024) return undefined;
        return blobToDataUrl(blob);
      })
      .then((dataUrl) => {
        if (abortController.signal.aborted || !dataUrl) return;
        updateSessionProfile(activeSessionId, {
          lastKnownAvatarDataUrl: dataUrl,
        });
      })
      .catch(() => undefined);

    return () => {
      abortController.abort();
    };
  }, [
    activeSessionId,
    avatarUrl,
    lastKnownAvatarDataUrl,
    lastKnownAvatarHttpUrl,
    lastKnownAvatarUrl,
    profile.avatarUrl,
  ]);

  const orderedSessions = useMemo(() => sessions, [sessions]);
  const accountItems = useMemo<AccountSwitcherItem[]>(
    () =>
      orderedSessions.map((session) => {
        const active = session.sessionId === activeSession?.sessionId;
        const sessionStoredAvatarHttpUrl = session.lastKnownAvatarUrl
          ? buildStoredAvatarHttpUrl(
              session.baseUrl,
              session.lastKnownAvatarUrl,
              96,
              96,
              session.accessToken
            )
          : undefined;
        return {
          session,
          active,
          displayName: active
            ? displayName
            : session.lastKnownDisplayName ?? getMxIdLocalPart(session.userId) ?? session.userId,
          avatarUrl: active
            ? activeAvatarSrc ?? session.lastKnownAvatarDataUrl ?? sessionStoredAvatarHttpUrl
            : session.lastKnownAvatarDataUrl ?? sessionStoredAvatarHttpUrl,
        };
      }),
    [activeAvatarSrc, activeSession?.sessionId, displayName, orderedSessions]
  );

  const openAccountSwitcher = () => setAccountSwitcher(true);
  const closeAccountSwitcher = () => setAccountSwitcher(false);
  const openSettings = () => setSettingsModal({});
  const openSettingsFromSwitcher = () => {
    closeAccountSwitcher();
    openSettings();
  };

  const addAccount = () => {
    closeAccountSwitcher();
    navigate(withAddAccountSearch(getLoginPath(activeSession?.baseUrl ?? mx.baseUrl)));
  };

  const switchAccount = (sessionId: string, path?: string) => {
    setActiveSession(sessionId);
    closeAccountSwitcher();
    navigate(resolveSessionRestorePath(path));
  };

  const removeAccount = async (sessionId: string) => {
    const session = sessions.find((item) => item.sessionId === sessionId);
    if (!session || session.sessionId === activeSession?.sessionId) return;

    setRemovingSessionId(sessionId);
    try {
      await removeStoredSession(session);
    } finally {
      setRemovingSessionId((current) => (current === sessionId ? undefined : current));
    }
  };

  return (
    <>
      {accountItems.map(
        ({ session, active, displayName: sessionDisplayName, avatarUrl: sessionAvatarUrl }) => (
          <SidebarItem key={session.sessionId} active={active}>
            <SidebarItemTooltip
              tooltip={
                active
                  ? `Settings: ${sessionDisplayName}`
                  : `Switch to ${sessionDisplayName} (${session.userId})`
              }
            >
              {(triggerRef) => (
                <SidebarAvatar
                  as="button"
                  aria-label={
                    active
                      ? `Open settings for ${sessionDisplayName}`
                      : `Switch to account ${sessionDisplayName} (${session.userId})`
                  }
                  ref={triggerRef}
                  onClick={() => {
                    if (active) {
                      openSettings();
                      return;
                    }

                    switchAccount(session.sessionId, session.lastKnownPath);
                  }}
                >
                  <UserAvatar
                    userId={session.userId}
                    src={sessionAvatarUrl}
                    renderFallback={() => <Text size="H4">{nameInitials(sessionDisplayName)}</Text>}
                  />
                </SidebarAvatar>
              )}
            </SidebarItemTooltip>
          </SidebarItem>
        )
      )}
      {accountItems.length > 1 && (
        <SidebarItem>
          <SidebarItemTooltip tooltip="Manage accounts">
            {(triggerRef) => (
              <SidebarAvatar
                as="button"
                aria-label="Manage accounts"
                ref={triggerRef}
                outlined
                onClick={openAccountSwitcher}
              >
                <Icon src={Icons.User} />
              </SidebarAvatar>
            )}
          </SidebarItemTooltip>
        </SidebarItem>
      )}
      <SidebarItem>
        <SidebarItemTooltip tooltip="Add Account">
          {(triggerRef) => (
            <SidebarAvatar
              as="button"
              aria-label="Add account"
              ref={triggerRef}
              outlined
              onClick={addAccount}
            >
              <Icon src={Icons.Plus} />
            </SidebarAvatar>
          )}
        </SidebarItemTooltip>
      </SidebarItem>
      {accountSwitcher && (
        <Modal500 requestClose={closeAccountSwitcher}>
          <AccountSwitcher
            accounts={accountItems}
            removingSessionId={removingSessionId}
            onOpenSettings={openSettingsFromSwitcher}
            onSwitchAccount={(session) => switchAccount(session.sessionId, session.lastKnownPath)}
            onRemoveAccount={(session) => {
              removeAccount(session.sessionId).catch(() => undefined);
            }}
            onAddAccount={addAccount}
            onClose={closeAccountSwitcher}
          />
        </Modal500>
      )}
    </>
  );
}
