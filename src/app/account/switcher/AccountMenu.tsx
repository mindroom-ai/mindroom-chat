import { useId, useMemo } from 'react';
import classNames from 'classnames';
import FocusTrap from 'focus-trap-react';
import { Avatar, Box, Icon, Icons, Line, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { PopOut, ownDirectionLine } from '../../ui/directional';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import { useMenuBehaviour } from '../../ui/glass/menuBehaviour';
import { ShortcutHint, shortcutAttributes } from '../../shortcuts/ShortcutKeys';
import { UserAvatar } from '../../avatars/UserAvatar';
import type { StoredSession } from '../../matrix/session/sessions';
import { nameInitials } from '../../lib/common';
import { stopPropagation } from '../../lib/keyboard';
import * as css from './AccountMenu.css';

/** An account signed in on this device, as the menu lists it. */
export type AccountMenuAccount = {
  session: StoredSession;
  displayName: string;
  avatarUrl?: string;
};

type AccountMenuProps = {
  /** The rail button the menu opens from; pressing it again closes the menu. */
  anchor: HTMLElement;
  /** The signed-in account, named in the centered card at the top. */
  active: { userId: string; displayName: string; avatarUrl?: string };
  /** The device's other accounts; choosing one switches to it. */
  others: AccountMenuAccount[];
  onOpenSettings: () => void;
  onSwitchAccount: (session: StoredSession) => void;
  onAddAccount: () => void;
  /** Signs out the active account, after the app's shared logout confirmation. */
  onSignOut: () => void;
  /** Opens the accounts dialog, which can also remove an account; absent with one account. */
  onManageAccounts?: () => void;
  onClose: () => void;
  /** Where the menu opens: beside the rail (default) or below a phone's top bar. */
  below?: boolean;
};

function AccountAvatar({
  userId,
  name,
  src,
  size,
}: {
  userId: string;
  name: string;
  src?: string;
  size: '200' | '500';
}) {
  return (
    <Avatar size={size} radii="Pill">
      <UserAvatar
        userId={userId}
        src={src}
        alt={name}
        renderFallback={() => (
          <Text size={size === '500' ? 'H4' : 'L400'}>{nameInitials(name)}</Text>
        )}
      />
    </Avatar>
  );
}

/**
 * The menu of the rail's account button: a centered header card for the signed-in account with a
 * Settings pill, an "Other accounts" well with Manage when more than one account is signed in,
 * and a split Add Account / Sign out footer. It opens beside the button; arrow keys walk every
 * actionable item in visual order, and Escape or a press elsewhere closes it. Like the app's
 * other menus it leaves keyboard focus to `installOverlayFocus`: opened with Enter or Space it
 * focuses Settings, and a key that closes it gives focus back to the button.
 */
export function AccountMenu({
  anchor,
  active,
  others,
  onOpenSettings,
  onSwitchAccount,
  onAddAccount,
  onSignOut,
  onManageAccounts,
  onClose,
  below = false,
}: AccountMenuProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const userIdId = useId();
  const othersHeadingId = useId();
  const entries = useMenuBehaviour<HTMLDivElement>('menu', undefined, undefined);
  const anchorRect = useMemo(() => anchor.getBoundingClientRect(), [anchor]);
  const maxBlockSize = useMemo(() => {
    const viewportCap =
      'calc(100dvh - 1rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))';
    const viewportHeight =
      typeof window !== 'undefined'
        ? document.documentElement.clientHeight || window.innerHeight
        : 0;
    if (viewportHeight <= 0) return viewportCap;
    // Leave room for PopOut's 8 px offset (when opening below/above) and an 8 px viewport margin.
    const available = below
      ? Math.max(viewportHeight - anchorRect.bottom, anchorRect.top) - 16
      : Math.max(anchorRect.bottom, viewportHeight - anchorRect.top) - 8;
    if (available <= 0) return viewportCap;
    return `min(${Math.floor(available)}px, ${viewportCap})`;
  }, [anchorRect, below]);
  const onAnchor = (target: EventTarget | null) =>
    target instanceof Node && anchor.contains(target);
  const closeThen = (action: () => void) => () => {
    onClose();
    action();
  };

  const menu = (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: false,
        returnFocusOnDeactivate: false,
        onDeactivate: onClose,
        escapeDeactivates: stopPropagation,
        // The button toggles the menu itself, so its press passes through instead of closing.
        clickOutsideDeactivates: (event) => !onAnchor(event.target),
        allowOutsideClick: (event) => onAnchor(event.target),
      }}
    >
      <Menu role="none" className={css.MenuSurface} style={{ maxBlockSize }}>
        <div
          role="menu"
          tabIndex={-1}
          aria-labelledby={`${nameId} ${userIdId}`}
          ref={entries.ref}
          onKeyDown={entries.onKeyDown}
          className={css.MenuBody}
        >
          <div className={css.MenuScrollBody}>
            <div className={css.HeaderCard}>
              <AccountAvatar
                userId={active.userId}
                name={active.displayName}
                src={active.avatarUrl}
                size="500"
              />
              <Text id={nameId} size="H5" truncate className={css.HeaderName} {...ownDirectionLine}>
                {active.displayName}
              </Text>
              <Text
                id={userIdId}
                size="T200"
                priority="300"
                truncate
                className={css.HeaderUserId}
                {...ownDirectionLine}
              >
                {active.userId}
              </Text>
              <button
                type="button"
                role="menuitem"
                className={css.SettingsPill}
                {...shortcutAttributes('settings')}
                onClick={closeThen(onOpenSettings)}
              >
                <Icon size="100" src={Icons.Setting} className={css.IconShrink} />
                <Text as="span" size="B300" truncate>
                  {t('settings.title')}
                </Text>
                <ShortcutHint id="settings" />
              </button>
            </div>
            {others.length > 0 && (
              <>
                <Line variant="Surface" size="300" role="separator" />
                <div role="group" aria-labelledby={othersHeadingId} className={css.AccountWell}>
                  <div className={css.AccountWellHead}>
                    <Text
                      as="span"
                      id={othersHeadingId}
                      size="O400"
                      priority="300"
                      className={css.WellHeading}
                    >
                      {t('featureUi.accountMenu.otherAccounts')}
                    </Text>
                    {onManageAccounts && (
                      <button
                        type="button"
                        role="menuitem"
                        className={css.ManageButton}
                        aria-label={t('accountsRail.manageAccounts')}
                        onClick={closeThen(onManageAccounts)}
                      >
                        <Text as="span" size="T200">
                          {t('featureUi.accountMenu.manage')}
                        </Text>
                      </button>
                    )}
                  </div>
                  <div className={css.AccountWellList}>
                    {others.map((account) => (
                      <MenuItem
                        key={account.session.sessionId}
                        role="menuitem"
                        size="400"
                        radii="300"
                        variant="SurfaceVariant"
                        className={css.AccountRow}
                        aria-label={t('accountsRail.switchAria', {
                          name: account.displayName,
                          userId: account.session.userId,
                        })}
                        before={
                          <AccountAvatar
                            userId={account.session.userId}
                            name={account.displayName}
                            src={account.avatarUrl}
                            size="200"
                          />
                        }
                        onClick={closeThen(() => onSwitchAccount(account.session))}
                      >
                        <Box as="span" direction="Column" className={css.TextColumn}>
                          <Text as="span" size="T300" truncate {...ownDirectionLine}>
                            {account.displayName}
                          </Text>
                          <Text as="span" size="T200" priority="300" truncate {...ownDirectionLine}>
                            {account.session.userId}
                          </Text>
                        </Box>
                      </MenuItem>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <Line variant="Surface" size="300" role="separator" className={css.Divider} />
          <div className={css.SplitFooter}>
            <button
              type="button"
              role="menuitem"
              className={css.SplitFooterButton}
              onClick={closeThen(onAddAccount)}
            >
              <Icon size="100" src={Icons.Plus} className={css.IconShrink} />
              <Text as="span" size="B300" className={css.FooterLabel}>
                {t('accountsRail.addAccount')}
              </Text>
            </button>
            <button
              type="button"
              role="menuitem"
              className={classNames(css.SplitFooterButton, css.SplitFooterSignOut)}
              onClick={closeThen(onSignOut)}
            >
              <Icon size="100" src={Icons.Power} className={css.IconShrink} />
              <Text as="span" size="B300" className={css.FooterLabel}>
                {t('settings.logout')}
              </Text>
            </button>
          </div>
        </div>
      </Menu>
    </FocusTrap>
  );

  return (
    <PopOut
      anchor={anchorRect}
      position={below ? 'Bottom' : 'Right'}
      align="End"
      offset={8}
      content={menu}
    />
  );
}
