import { useId, useMemo } from 'react';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Avatar, Box, Icons, Line, Text, config, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import { PopOut } from '../../ui/directional';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import { MenuEntry, MenuGroup } from '../../ui/MenuEntry';
import { UserAvatar } from '../../avatars/user-avatar';
import type { StoredSession } from '../../matrix/session/sessions';
import { nameInitials } from '../../lib/common';
import { stopPropagation } from '../../lib/keyboard';

/** An account signed in on this device, as the menu lists it. */
export type AccountMenuAccount = {
  session: StoredSession;
  displayName: string;
  avatarUrl?: string;
};

type AccountMenuProps = {
  /** The rail button the menu opens from; pressing it again closes the menu. */
  anchor: HTMLElement;
  /** The signed-in account, named at the top. */
  active: { userId: string; displayName: string; avatarUrl?: string };
  /** The device's other accounts; choosing one switches to it. */
  others: AccountMenuAccount[];
  onOpenSettings: () => void;
  onSwitchAccount: (session: StoredSession) => void;
  onAddAccount: () => void;
  /** Opens the accounts dialog, which can also remove an account; absent with one account. */
  onManageAccounts?: () => void;
  onClose: () => void;
};

const forward = (event: KeyboardEvent) => isHotkey(['arrowdown', 'tab'], event);
const backward = (event: KeyboardEvent) => isHotkey(['arrowup', 'shift+tab'], event);

const twoLineRow = { blockSize: 'auto', minBlockSize: toRem(44), paddingBlock: config.space.S100 };
const textColumn = { minWidth: 0, flexGrow: 1, textAlign: 'start' } as const;

function AccountAvatar({
  userId,
  name,
  src,
  size,
}: {
  userId: string;
  name: string;
  src?: string;
  size: '200' | '300';
}) {
  return (
    <Avatar size={size} radii="Pill">
      <UserAvatar
        userId={userId}
        src={src}
        alt={name}
        renderFallback={() => (
          <Text size={size === '300' ? 'H6' : 'L400'}>{nameInitials(name)}</Text>
        )}
      />
    </Avatar>
  );
}

/**
 * The menu of the rail's account button: the signed-in account, Settings, the other accounts on
 * this device, Add Account and, with more than one account, Manage Accounts. It opens beside the
 * button; arrow keys walk the entries, and Escape or a press elsewhere closes it. Like the app's
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
  onManageAccounts,
  onClose,
}: AccountMenuProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const userIdId = useId();
  const anchorRect = useMemo(() => anchor.getBoundingClientRect(), [anchor]);
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
        isKeyForward: forward,
        isKeyBackward: backward,
      }}
    >
      <Menu style={{ inlineSize: toRem(272), maxInlineSize: 'calc(100vw - 5rem)' }}>
        <Box alignItems="Center" gap="300" style={{ padding: config.space.S300 }}>
          <AccountAvatar
            userId={active.userId}
            name={active.displayName}
            src={active.avatarUrl}
            size="300"
          />
          <Box direction="Column" style={textColumn}>
            <Text id={nameId} size="H6" truncate>
              {active.displayName}
            </Text>
            <Text id={userIdId} size="T200" priority="300" truncate>
              {active.userId}
            </Text>
          </Box>
        </Box>
        <Line variant="Surface" size="300" />
        <div role="menu" aria-labelledby={`${nameId} ${userIdId}`}>
          <MenuGroup>
            <MenuEntry
              role="menuitem"
              icon={Icons.Setting}
              label={t('settings.title')}
              shortcut="settings"
              onSelect={closeThen(onOpenSettings)}
            />
          </MenuGroup>
          {others.length > 0 && (
            <>
              <Line variant="Surface" size="300" role="separator" />
              <MenuGroup>
                {others.map((account) => (
                  <MenuItem
                    key={account.session.sessionId}
                    role="menuitem"
                    size="400"
                    radii="300"
                    variant="Surface"
                    style={twoLineRow}
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
                    <Box as="span" direction="Column" style={textColumn}>
                      <Text as="span" size="T300" truncate>
                        {account.displayName}
                      </Text>
                      <Text as="span" size="T200" priority="300" truncate>
                        {account.session.userId}
                      </Text>
                    </Box>
                  </MenuItem>
                ))}
              </MenuGroup>
            </>
          )}
          <Line variant="Surface" size="300" role="separator" />
          <MenuGroup>
            <MenuEntry
              role="menuitem"
              icon={Icons.Plus}
              label={t('accountsRail.addAccount')}
              onSelect={closeThen(onAddAccount)}
            />
            {onManageAccounts && (
              <MenuEntry
                role="menuitem"
                icon={Icons.User}
                label={t('featureUi.accountMenu.manageAccounts')}
                onSelect={closeThen(onManageAccounts)}
              />
            )}
          </MenuGroup>
        </div>
      </Menu>
    </FocusTrap>
  );

  return <PopOut anchor={anchorRect} position="Right" align="End" offset={8} content={menu} />;
}
