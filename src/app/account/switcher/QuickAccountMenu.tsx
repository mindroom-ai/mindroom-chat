import { type Ref, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { PopOut, ownDirectionLine } from '../../ui/directional';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { UserAvatar } from '../../avatars/UserAvatar';
import { nameInitials } from '../../lib/common';
import type { AccountMenuAccount } from './AccountMenu';
import * as css from './QuickAccountMenu.css';

type QuickAccountMenuProps = {
  /** The avatar button the quick switcher opens from. */
  anchor: HTMLElement;
  /** The device's other accounts, sorted MRU-first. */
  others: AccountMenuAccount[];
  /** Session ID currently highlighted under the dragging pointer. */
  hoveredSessionId?: string;
  /** Ref forwarded to the menu root for pointer hit-testing. */
  menuRef?: Ref<HTMLDivElement>;
  /** Where the menu opens: beside the rail (default) or below a phone's top bar. */
  below?: boolean;
};

/**
 * Compact glass account switcher opened by pressing and holding the account avatar. Lists the
 * other signed-in accounts ordered closest-to-thumb (MRU first below the phone top bar, MRU at
 * the bottom beside the rail) without taking focus so a hold-and-swipe gesture switches cleanly
 * on pointer release.
 */
export function QuickAccountMenu({
  anchor,
  others,
  hoveredSessionId,
  menuRef,
  below = false,
}: QuickAccountMenuProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const measure = useCallback(
    () => ({
      anchorRect: anchor.getBoundingClientRect(),
      viewportHeight: document.documentElement.clientHeight || window.innerHeight,
    }),
    [anchor]
  );
  const [{ anchorRect, viewportHeight }, setMeasured] = useState(measure);
  useLayoutEffect(() => {
    setMeasured(measure());
    const onResize = () => setMeasured(measure());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  const maxBlockSize = useMemo(() => {
    const viewportCap =
      'calc(100dvh - 1rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))';
    if (viewportHeight <= 0) return viewportCap;
    const available = below
      ? Math.max(viewportHeight - anchorRect.bottom, anchorRect.top) - 16
      : Math.max(anchorRect.bottom, viewportHeight - anchorRect.top) - 8;
    if (available <= 0) return viewportCap;
    return `min(${Math.floor(available)}px, ${viewportCap})`;
  }, [anchorRect, viewportHeight, below]);

  // Closest-to-thumb ordering: below the top-right avatar MRU stays at the top; beside the
  // bottom-left rail MRU sits at the bottom right next to the avatar.
  const orderedAccounts = useMemo(() => (below ? others : [...others].reverse()), [others, below]);

  // Beside the bottom-left rail, scroll to the bottom on open (and when the account count changes)
  // so the MRU row sits immediately next to the avatar even when the list overflows.
  useLayoutEffect(() => {
    if (below) return;
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
  }, [below, others.length]);

  const menu = (
    <Menu
      ref={menuRef}
      role="menu"
      aria-label={t('featureUi.accountMenu.otherAccounts')}
      className={css.MenuSurface}
      data-quick-account-menu=""
      data-below={below ? 'true' : undefined}
      style={{ maxBlockSize }}
    >
      <div className={css.Header}>
        <Text as="span" size="O400" priority="300" className={css.Heading}>
          {t('featureUi.accountMenu.otherAccounts')}
        </Text>
      </div>
      <div ref={listRef} className={css.AccountList} data-quick-account-list="">
        {orderedAccounts.map((account) => {
          const highlighted = account.session.sessionId === hoveredSessionId;
          return (
            <div
              key={account.session.sessionId}
              role="menuitem"
              data-quick-account-session-id={account.session.sessionId}
              data-highlighted={highlighted ? 'true' : undefined}
              aria-label={t('accountsRail.switchAria', {
                name: account.displayName,
                userId: account.session.userId,
              })}
              className={css.AccountRow}
            >
              <Avatar size="200" radii="Pill" aria-hidden="true" className={css.AvatarShrink}>
                <UserAvatar
                  userId={account.session.userId}
                  src={account.avatarUrl}
                  alt={account.displayName}
                  renderFallback={() => (
                    <Text size="L400">{nameInitials(account.displayName)}</Text>
                  )}
                />
              </Avatar>
              <Box as="span" direction="Column" className={css.TextColumn}>
                <Text as="span" size="T300" truncate {...ownDirectionLine}>
                  {account.displayName}
                </Text>
                <Text as="span" size="T200" priority="300" truncate {...ownDirectionLine}>
                  {account.session.userId}
                </Text>
              </Box>
              <span
                className={css.TrailingArrow}
                data-highlighted={highlighted ? 'true' : undefined}
                aria-hidden="true"
              >
                <Icon size="100" src={Icons.ArrowRight} className={css.TrailingArrowIcon} />
              </span>
            </div>
          );
        })}
      </div>
    </Menu>
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
