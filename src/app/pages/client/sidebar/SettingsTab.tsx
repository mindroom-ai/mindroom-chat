import React, { useEffect, useMemo, useState } from 'react';
import { Icon, Icons, Text } from 'folds';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { UserAvatar } from '../../../components/user-avatar';
import { authenticatedAvatarRequest } from '../../../components/user-avatar/avatarMedia';
import { Modal500 } from '../../../components/Modal500';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { useActiveSession, useStoredSessions } from '../../../hooks/useSessionStore';
import {
  setActiveSession,
  updateSessionProfile,
  type StoredSession,
} from '../../../state/sessions';
import { settingsModalAtom } from '../../../state/settingsModal';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { nameInitials } from '../../../utils/common';
import { removeStoredSession } from '../../../../client/initMatrix';
import { getLoginPath } from '../../pathUtils';
import { withAddAccountSearch } from '../../auth/addAccount';
import { resolveSessionRestorePath } from '../sessionRouteRestore';
import { AccountSwitcher } from './AccountSwitcher';

const AVATAR_SIZE = 96;

const sessionName = (session: StoredSession): string =>
  session.lastKnownDisplayName ?? getMxIdLocalPart(session.userId) ?? session.userId;

const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('No data'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the avatar'));
    reader.readAsDataURL(blob);
  });

/**
 * The active account's avatar as a data URL. It is cached on the stored
 * session, so the rail shows it before the profile loads and offline; the
 * authenticated media URL itself is never handed to an `<img>`.
 */
const useCachedActiveAvatar = (
  session: StoredSession,
  liveMxc: string | undefined,
  resolved: boolean
) => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [fetched, setFetched] = useState<{ mxc: string; dataUrl: string }>();
  const targetMxc = resolved ? liveMxc : session.lastKnownAvatarUrl;
  const cachedMatches =
    !!session.lastKnownAvatarDataUrl && session.lastKnownAvatarUrl === targetMxc;

  useEffect(() => {
    if (!targetMxc || cachedMatches || fetched?.mxc === targetMxc) return undefined;
    const httpUrl = mxcUrlToHttp(
      mx,
      targetMxc,
      useAuthentication,
      AVATAR_SIZE,
      AVATAR_SIZE,
      'crop'
    );
    if (!httpUrl) return undefined;
    const accessToken = mx.getAccessToken();
    let cancelled = false;
    (async () => {
      try {
        let response = await fetch(
          httpUrl,
          useAuthentication && accessToken
            ? { headers: { Authorization: `Bearer ${accessToken}` } }
            : {}
        );
        // Without a service worker the URL is a legacy one, which servers with authenticated
        // media may refuse; ask the authenticated endpoint with the token instead.
        const retry =
          response.ok || useAuthentication ? undefined : authenticatedAvatarRequest(mx, httpUrl);
        if (retry) response = await fetch(retry.url, retry.init);
        if (!response.ok) return;
        const dataUrl = await readBlobAsDataUrl(await response.blob());
        if (cancelled) return;
        setFetched({ mxc: targetMxc, dataUrl });
        if (resolved) {
          updateSessionProfile(session.sessionId, {
            lastKnownAvatarUrl: targetMxc,
            lastKnownAvatarDataUrl: dataUrl,
          });
        }
      } catch {
        // The rail falls back to initials.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mx, useAuthentication, targetMxc, cachedMatches, fetched?.mxc, resolved, session.sessionId]);

  if (fetched && fetched.mxc === targetMxc) return fetched.dataUrl;
  if (session.lastKnownAvatarDataUrl && (cachedMatches || !resolved))
    return session.lastKnownAvatarDataUrl;
  return undefined;
};

/** The account area at the bottom of the icon rail: settings, add account, and other accounts. */
export function SettingsTab() {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const activeSessionHook = useActiveSession();
  const sessions = useStoredSessions();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [error, setError] = useState<string>();

  const userId = activeSessionHook?.userId ?? client.getUserId() ?? '';
  // The stored copy carries the freshest cached profile fields.
  const activeSession =
    sessions.find((session) => session.sessionId === activeSessionHook?.sessionId) ??
    activeSessionHook;
  const profile = useUserProfile(userId);

  const displayName = profile.isDisplayNameResolved
    ? profile.displayName ?? getMxIdLocalPart(userId) ?? userId
    : activeSession?.lastKnownDisplayName ?? getMxIdLocalPart(userId) ?? userId;

  useEffect(() => {
    if (!activeSession || !profile.isDisplayNameResolved || !profile.displayName) return;
    if (activeSession.lastKnownDisplayName === profile.displayName) return;
    updateSessionProfile(activeSession.sessionId, { lastKnownDisplayName: profile.displayName });
  }, [activeSession, profile.isDisplayNameResolved, profile.displayName]);

  const avatarSrc = useCachedActiveAvatar(
    activeSession ?? ({ sessionId: '', userId } as StoredSession),
    profile.avatarUrl,
    profile.isAvatarResolved
  );

  const otherSessions = useMemo(
    () => sessions.filter((session) => session.sessionId !== activeSession?.sessionId),
    [sessions, activeSession?.sessionId]
  );

  const failed = () => {
    setError(t('accountSwitcher.actionError'));
    setSwitcherOpen(true);
  };

  const handleSwitch = (session: StoredSession) => {
    let next: StoredSession | undefined;
    try {
      next = setActiveSession(session.sessionId);
    } catch {
      next = undefined;
    }
    if (!next) {
      failed();
      return;
    }
    setError(undefined);
    setSwitcherOpen(false);
    // The stored path of the account chosen; the store's copy may already point elsewhere.
    navigate(resolveSessionRestorePath(session.lastKnownPath));
  };

  const handleRemove = async (session: StoredSession) => {
    try {
      await removeStoredSession(session);
      setError(undefined);
    } catch {
      failed();
    }
  };

  const handleAddAccount = () => {
    setSwitcherOpen(false);
    navigate(withAddAccountSearch(getLoginPath(activeSession?.baseUrl)));
  };

  const openSettings = () => {
    setSwitcherOpen(false);
    setSettingsModal({});
  };

  // The active account carries the rail's selection mark, with Add account on its corner.
  return (
    <>
      <SidebarItem active>
        <SidebarItemTooltip tooltip={t('accountsRail.openSettingsAria', { name: displayName })}>
          {(triggerRef) => (
            <SidebarAvatar
              as="button"
              ref={triggerRef}
              aria-label={t('accountsRail.openSettingsAria', { name: displayName })}
              onClick={openSettings}
            >
              <UserAvatar
                userId={userId}
                src={avatarSrc}
                alt={displayName}
                renderFallback={() => <Text size="H6">{nameInitials(displayName)}</Text>}
              />
            </SidebarAvatar>
          )}
        </SidebarItemTooltip>
        <SidebarItemTooltip tooltip={t('accountsRail.addAccountAria')}>
          {(triggerRef) => (
            <SidebarAvatar
              as="button"
              corner
              ref={triggerRef}
              aria-label={t('accountsRail.addAccountAria')}
              onClick={handleAddAccount}
            >
              <Icon size="50" src={Icons.Plus} />
            </SidebarAvatar>
          )}
        </SidebarItemTooltip>
      </SidebarItem>
      {otherSessions.map((session) => {
        const name = sessionName(session);
        const label = t('accountsRail.switchAria', { name, userId: session.userId });
        return (
          <SidebarItem key={session.sessionId}>
            <SidebarItemTooltip tooltip={label}>
              {(triggerRef) => (
                <SidebarAvatar
                  as="button"
                  size="300"
                  ref={triggerRef}
                  aria-label={label}
                  onClick={() => handleSwitch(session)}
                >
                  <UserAvatar
                    userId={session.userId}
                    src={session.lastKnownAvatarDataUrl}
                    alt={name}
                    renderFallback={() => <Text size="H6">{nameInitials(name)}</Text>}
                  />
                </SidebarAvatar>
              )}
            </SidebarItemTooltip>
          </SidebarItem>
        );
      })}
      {sessions.length > 1 && (
        <SidebarItem>
          <SidebarItemTooltip tooltip={t('accountsRail.manageAccounts')}>
            {(triggerRef) => (
              <SidebarAvatar
                as="button"
                size="300"
                ref={triggerRef}
                aria-label={t('accountsRail.manageAccounts')}
                onClick={() => setSwitcherOpen(true)}
              >
                <Text size="L400">{sessions.length}</Text>
              </SidebarAvatar>
            )}
          </SidebarItemTooltip>
        </SidebarItem>
      )}
      {switcherOpen && (
        <Modal500 requestClose={() => setSwitcherOpen(false)}>
          <AccountSwitcher
            accounts={sessions.map((session) => ({
              session,
              active: session.sessionId === activeSession?.sessionId,
              displayName:
                session.sessionId === activeSession?.sessionId ? displayName : sessionName(session),
              avatarUrl:
                session.sessionId === activeSession?.sessionId
                  ? avatarSrc
                  : session.lastKnownAvatarDataUrl,
            }))}
            error={error}
            onOpenSettings={openSettings}
            onSwitchAccount={handleSwitch}
            onRemoveAccount={handleRemove}
            onAddAccount={handleAddAccount}
            onClose={() => setSwitcherOpen(false)}
          />
        </Modal500>
      )}
    </>
  );
}
