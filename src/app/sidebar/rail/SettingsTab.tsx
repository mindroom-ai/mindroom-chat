import { type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { Avatar, IconButton, Overlay, OverlayBackdrop, OverlayCenter, Text } from 'folds';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../ui/sidebar/SidebarItem';
import { UserAvatar } from '../../avatars/UserAvatar';
import { authenticatedAvatarRequest } from '../../avatars/avatarMedia';
import { Modal500 } from '../../ui/Modal500';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useUserProfile } from '../../members/useUserProfile';
import { useActiveSession, useStoredSessions } from '../../matrix/session/useSessionStore';
import {
  setActiveSession,
  updateSessionProfile,
  type StoredSession,
} from '../../matrix/session/sessions';
import { settingsModalAtom } from '../../navigation/settingsModal';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../matrix/matrix';
import { nameInitials } from '../../lib/common';
import { getLoginPath } from '../../routes/pathUtils';
import { withAddAccountSearch } from '../../navigation/addAccount';
import { resolveSessionRestorePath } from '../../routes/sessionRouteRestore';
import { AccountMenu } from '../../account/switcher/AccountMenu';
import { AccountSwitcher } from '../../account/switcher/AccountSwitcher';
import { LogoutDialog } from '../../account/LogoutDialog';
import { useShortcut } from '../../shortcuts/useShortcut';

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
    void (async () => {
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

/**
 * The account button at the foot of the icon rail, or with `inTopBar` at the end of a phone's top
 * bar: the active account's avatar, which opens the account menu (Settings, the other accounts,
 * Add Account, Manage Accounts).
 */
export function SettingsTab({
  inTopBar = false,
  className,
}: {
  inTopBar?: boolean;
  /** Classes of the top bar's button. */
  className?: string;
}) {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const activeSessionHook = useActiveSession();
  const sessions = useStoredSessions();
  const [menuButton, setMenuButton] = useState<HTMLElement>();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [error, setError] = useState<string>();
  /** The inactive account whose logout waits for confirmation. */
  const [leaving, setLeaving] = useState<StoredSession>();

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

  const otherAccounts = useMemo(
    () =>
      sessions
        .filter((session) => session.sessionId !== activeSession?.sessionId)
        .map((session) => ({
          session,
          displayName: sessionName(session),
          avatarUrl: session.lastKnownAvatarDataUrl,
        })),
    [sessions, activeSession?.sessionId]
  );

  const closeMenu = useCallback(() => setMenuButton(undefined), []);

  const failed = useCallback(() => {
    setMenuButton(undefined);
    setError(t('accountSwitcher.actionError'));
    setSwitcherOpen(true);
  }, [t]);

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

  const closeLeaving = useCallback(() => setLeaving(undefined), []);

  const handleAddAccount = () => {
    setSwitcherOpen(false);
    navigate(withAddAccountSearch(getLoginPath(activeSession?.baseUrl)));
  };

  const openSettings = () => {
    setSwitcherOpen(false);
    setSettingsModal({});
  };
  useShortcut('settings', () => {
    openSettings();
    return true;
  });

  // Pressing the avatar while its menu is open closes the menu.
  const toggleAccountMenu = (event: MouseEvent<HTMLElement>) => {
    const button = event.currentTarget;
    setMenuButton((open) => (open ? undefined : button));
  };

  const label = t('featureUi.accountMenu.open', { name: displayName });

  const avatar = (
    <UserAvatar
      userId={userId}
      src={avatarSrc}
      alt={displayName}
      renderFallback={() => <Text size="H6">{nameInitials(displayName)}</Text>}
    />
  );
  const accountMenu = menuButton && (
    <AccountMenu
      anchor={menuButton}
      active={{ userId, displayName, avatarUrl: avatarSrc }}
      others={otherAccounts}
      onOpenSettings={openSettings}
      onSwitchAccount={handleSwitch}
      onAddAccount={handleAddAccount}
      onManageAccounts={otherAccounts.length > 0 ? () => setSwitcherOpen(true) : undefined}
      onClose={closeMenu}
      below={inTopBar}
    />
  );

  // In the rail the active account carries the selection mark and its menu opens beside it; in
  // the top bar the menu opens below the avatar.
  return (
    <>
      {inTopBar ? (
        <>
          <IconButton
            className={className}
            size="400"
            radii="Pill"
            variant="Background"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={!!menuButton}
            onClick={toggleAccountMenu}
          >
            <Avatar size="200" radii="Pill">
              {avatar}
            </Avatar>
          </IconButton>
          {accountMenu}
        </>
      ) : (
        <SidebarItem active>
          <SidebarItemTooltip tooltip={label}>
            {(triggerRef) => (
              <SidebarAvatar
                as="button"
                ref={triggerRef}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={!!menuButton}
                // The signed-in account, not an open page.
                aria-current="true"
                onClick={toggleAccountMenu}
              >
                {avatar}
              </SidebarAvatar>
            )}
          </SidebarItemTooltip>
          {accountMenu}
        </SidebarItem>
      )}
      {switcherOpen && (
        <Modal500 requestClose={() => setSwitcherOpen(false)} fillPhoneScreen fitContent narrow>
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
            onRemoveAccount={setLeaving}
            onAddAccount={handleAddAccount}
            onClose={() => setSwitcherOpen(false)}
          />
        </Modal500>
      )}
      {leaving && (
        <Overlay open backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            {/* Escape or a click beside the confirmation keeps the account. */}
            <FocusTrap
              focusTrapOptions={{
                clickOutsideDeactivates: true,
                onDeactivate: closeLeaving,
              }}
            >
              <LogoutDialog session={leaving} handleClose={closeLeaving} />
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
    </>
  );
}
