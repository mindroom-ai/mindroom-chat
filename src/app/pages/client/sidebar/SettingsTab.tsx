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
import { getHomePath, getLoginPath } from '../../pathUtils';
import { withAddAccountSearch } from '../../auth/addAccount';

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

  const [settings, setSettings] = useState(false);

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
    if (!activeSession || !avatarUrl) return undefined;
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

  const openSettings = () => setSettings(true);
  const closeSettings = () => setSettings(false);

  return (
    <>
      {orderedSessions.map((session) => {
        const active = session.sessionId === activeSession?.sessionId;
        const sessionDisplayName = active
          ? displayName
          : session.lastKnownDisplayName ?? getMxIdLocalPart(session.userId) ?? session.userId;
        const sessionAvatarUrl = active ? avatarUrl : session.lastKnownAvatarDataUrl;

        return (
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
                  ref={triggerRef}
                  onClick={() => {
                    if (active) {
                      openSettings();
                      return;
                    }

                    setActiveSession(session.sessionId);
                    navigate(session.lastKnownPath ?? getHomePath());
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
        );
      })}
      <SidebarItem>
        <SidebarItemTooltip tooltip="Add Account">
          {(triggerRef) => (
            <SidebarAvatar
              as="button"
              ref={triggerRef}
              outlined
              onClick={() => navigate(withAddAccountSearch(getLoginPath()))}
            >
              <Icon src={Icons.Plus} />
            </SidebarAvatar>
          )}
        </SidebarItemTooltip>
      </SidebarItem>
      {settings && (
        <Modal500 requestClose={closeSettings}>
          <Settings requestClose={closeSettings} />
        </Modal500>
      )}
    </>
  );
}
