import React, { useEffect, useMemo, useState } from 'react';
import { Icon, Icons, Text } from 'folds';
import { useNavigate } from 'react-router-dom';
import { SidebarItem, SidebarItemTooltip, SidebarAvatar } from '../../../components/sidebar';
import { UserAvatar } from '../../../components/user-avatar';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { nameInitials } from '../../../utils/common';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { Settings } from '../../../features/settings';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { Modal500 } from '../../../components/Modal500';
import { useActiveSession, useStoredSessions } from '../../../hooks/useSessionStore';
import { setActiveSession, updateSessionProfile } from '../../../state/sessions';
import { getLoginPath } from '../../pathUtils';
import { withAddAccountSearch } from '../../auth/addAccount';
import { removeStoredSession } from '../../../../client/initMatrix';
import { AccountSwitcher, AccountSwitcherItem } from './AccountSwitcher';
import { resolveSessionRestorePath } from '../sessionRouteRestore';

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
  const activeSession = useActiveSession();
  const sessions = useStoredSessions();
  const userId = mx.getUserId() ?? activeSession?.userId ?? '';
  const profile = useUserProfile(userId);

  const [accountSwitcher, setAccountSwitcher] = useState(false);
  const [settings, setSettings] = useState(false);
  const [removingSessionId, setRemovingSessionId] = useState<string>();

  const displayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const avatarUrl = profile.avatarUrl
    ? mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;

  useEffect(() => {
    if (!activeSession) return;

    updateSessionProfile(activeSession.sessionId, {
      lastKnownDisplayName: displayName,
      lastKnownAvatarUrl: profile.avatarUrl ?? undefined,
    });
  }, [activeSession, displayName, profile.avatarUrl]);

  useEffect(() => {
    if (!activeSession) return undefined;
    if (!avatarUrl) {
      updateSessionProfile(activeSession.sessionId, {
        lastKnownAvatarDataUrl: undefined,
      });
      return undefined;
    }
    let disposed = false;

    fetch(avatarUrl)
      .then(async (response) => {
        if (!response.ok) return undefined;
        const blob = await response.blob();
        if (blob.size > 128 * 1024) return undefined;
        return blobToDataUrl(blob);
      })
      .then((dataUrl) => {
        if (disposed || !dataUrl) return;
        updateSessionProfile(activeSession.sessionId, {
          lastKnownAvatarDataUrl: dataUrl,
        });
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, [activeSession, avatarUrl]);

  const orderedSessions = useMemo(() => sessions, [sessions]);
  const accountItems = useMemo<AccountSwitcherItem[]>(
    () =>
      orderedSessions.map((session) => {
        const active = session.sessionId === activeSession?.sessionId;
        return {
          session,
          active,
          displayName: active
            ? displayName
            : session.lastKnownDisplayName ?? getMxIdLocalPart(session.userId) ?? session.userId,
          avatarUrl: active ? avatarUrl : session.lastKnownAvatarDataUrl,
        };
      }),
    [activeSession?.sessionId, avatarUrl, displayName, orderedSessions]
  );

  const openAccountSwitcher = () => setAccountSwitcher(true);
  const closeAccountSwitcher = () => setAccountSwitcher(false);
  const openSettings = () => setSettings(true);
  const closeSettings = () => setSettings(false);
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
                  ? `Manage accounts: ${sessionDisplayName}`
                  : `Switch to ${sessionDisplayName} (${session.userId})`
              }
            >
              {(triggerRef) => (
                <SidebarAvatar
                  as="button"
                  aria-label={
                    active
                      ? `Open account switcher for ${sessionDisplayName}`
                      : `Switch to account ${sessionDisplayName} (${session.userId})`
                  }
                  ref={triggerRef}
                  onClick={() => {
                    if (active) {
                      openAccountSwitcher();
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
      {settings && (
        <Modal500 requestClose={closeSettings}>
          <Settings requestClose={closeSettings} />
        </Modal500>
      )}
    </>
  );
}
