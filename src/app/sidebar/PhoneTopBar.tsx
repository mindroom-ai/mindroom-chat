import { useId, useState } from 'react';
import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Badge, Icon, IconButton, Icons, Text, type IconSrc } from 'folds';
import { phoneNavDrawerOpenAtom } from '../navigation/phoneNavDrawer';
import { commandPaletteOpenAtom } from '../command-palette/commandPaletteState';
import {
  getCommandPaletteAriaKeyShortcuts,
  getCommandPaletteShortcutLabel,
} from '../command-palette/commandPaletteShortcut';
import { allRoomsAtom } from '../matrix/state/roomList';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { useRoomsUnread } from '../matrix/state/useUnread';
import { useActivityBadge } from '../activity/useActivityRows';
import { ActivitySheet } from '../activity/ActivitySheet';
import { SettingsTab } from './rail/SettingsTab';
import { ActivityBadge } from './rail/ActivityTab';
import * as css from './PhoneTopBar.css';

/** The drawer's element, which the menu button controls. */
export const PHONE_NAV_DRAWER_ID = 'phone-nav-drawer';
/** The menu button, which takes the focus back when the drawer closes around it. */
export const PHONE_NAV_MENU_BUTTON_ID = 'phone-nav-menu-button';

/** Three bars, the usual sign for a menu that slides in. */
const MenuIcon: IconSrc = () => (
  <path
    d="M4 6h16M4 12h16M4 18h16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  />
);

/** The menu button, with a dot while any room has unread messages. */
function MenuButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(phoneNavDrawerOpenAtom);
  const unread = useRoomsUnread(useAtomValue(allRoomsAtom), roomToUnreadAtom);
  const unreadId = useId();
  // Any unread room, also one whose messages notify nobody, as the rail's badges count them.
  const hasUnread = !!unread;
  return (
    <div className={css.MenuButtonFrame}>
      <IconButton
        id={PHONE_NAV_MENU_BUTTON_ID}
        className={css.BarControl}
        size="400"
        radii="300"
        variant={open ? 'Secondary' : 'Background'}
        // One name; whether the drawer is out is `aria-expanded`'s to say.
        aria-label={t('featureUi.phoneNav.navigation')}
        aria-expanded={open}
        aria-controls={PHONE_NAV_DRAWER_ID}
        aria-describedby={hasUnread ? unreadId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon src={MenuIcon} />
      </IconButton>
      {hasUnread && (
        <span className={css.UnreadDot} data-highlight={(unread?.highlight ?? 0) > 0 || undefined}>
          <span id={unreadId} hidden>
            {t('thread.aria.unreadMessages')}
          </span>
        </span>
      )}
    </div>
  );
}

/** The Activity bell, with the unread count; it slides the Activity list up as a sheet. */
function ActivityBell() {
  const { t } = useTranslation();
  const { count, needsYou } = useActivityBadge();
  const [open, setOpen] = useState(false);
  const label = count > 0 ? t('activity.bellLabelCount', { count }) : t('activity.bellLabel');
  return (
    <div className={css.BellFrame}>
      <IconButton
        className={css.BarControl}
        size="400"
        radii="Pill"
        variant="Background"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon size="200" src={Icons.Bell} />
      </IconButton>
      {count > 0 && (
        <span className={css.BellBadge} aria-hidden>
          <ActivityBadge count={count} needsYou={needsYou} />
        </span>
      )}
      {open && <ActivitySheet requestClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * A phone's top bar, above every page: the menu button that slides the navigation drawer in, a
 * search field that opens the command palette (and names its keyboard shortcut), the Activity
 * bell, and the account.
 */
export function PhoneTopBar() {
  const { t } = useTranslation();
  const [paletteTab, setPaletteTab] = useAtom(commandPaletteOpenAtom);
  const search = t('featureUi.phoneNav.search');
  return (
    <div className={css.PhoneTopBar} data-phone-top-bar>
      <MenuButton />
      <button
        type="button"
        className={classNames(css.SearchField, css.BarControl)}
        aria-keyshortcuts={getCommandPaletteAriaKeyShortcuts()}
        aria-haspopup="dialog"
        aria-expanded={paletteTab !== undefined}
        onClick={() => setPaletteTab('all')}
      >
        <Icon size="100" src={Icons.Search} />
        <Text as="span" size="T300" truncate className={css.SearchPlaceholder}>
          {search}
        </Text>
        {/* Named by aria-keyshortcuts; its glyphs would only lengthen the button's name. */}
        <Badge as="kbd" variant="Secondary" fill="Soft" radii="300" aria-hidden>
          <Text as="span" size="L400">
            {getCommandPaletteShortcutLabel()}
          </Text>
        </Badge>
      </button>
      <ActivityBell />
      <SettingsTab inTopBar className={css.BarControl} />
    </div>
  );
}
