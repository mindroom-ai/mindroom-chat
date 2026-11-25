import { Suspense, useCallback, useState, type MouseEvent, type RefCallback } from 'react';
import { IconButton } from 'folds';
import { IconHelpCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { lazyPart } from '../../lib/lazyPart';
import { useContextualTip } from '../../tour/useContextualTip';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../ui/sidebar/SidebarItem';
import * as css from './HelpTab.css';
import { useRailVisibilityMenuTrigger } from './railVisibilityMenuContext';

const HelpMenu = lazyPart(() =>
  import('../../tour/HelpMenu').then((module) => ({ default: module.HelpMenu }))
);

type HelpTabProps = {
  /** In a phone's top bar rather than the icon rail: opens the menu below the button. */
  inTopBar?: boolean;
  /** Applied to the top-bar button so it matches the bar's touch target. */
  className?: string;
};

/**
 * The `?` Help & guides trigger for the desktop icon rail and phone top bar. Shows a subtle
 * accent dot when a contextual tip applies and opens the Help & guides popover on click.
 */
export function HelpTab({ inTopBar = false, className }: HelpTabProps) {
  const { t } = useTranslation();
  const { tip } = useContextualTip();
  const [menuButton, setMenuButton] = useState<HTMLElement>();
  const closeMenu = useCallback(() => setMenuButton(undefined), []);
  const railMenuProps = useRailVisibilityMenuTrigger('help', {
    disabled: inTopBar,
    onBeforeOpen: closeMenu,
  });
  const toggleMenu = (event: MouseEvent<HTMLElement>) => {
    const button = event.currentTarget;
    setMenuButton((open) => (open ? undefined : button));
  };

  const hasDot = tip !== undefined && !menuButton;
  const label = tip ? t('tour.help.buttonWithTip') : t('tour.help.button');
  const helpMenu = menuButton && (
    <Suspense fallback={null}>
      <HelpMenu anchor={menuButton} below={inTopBar} onClose={closeMenu} />
    </Suspense>
  );

  if (inTopBar) {
    return (
      <span className={css.TopBarFrame}>
        <IconButton
          className={className}
          size="400"
          radii="Pill"
          variant="Background"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={!!menuButton}
          onClick={toggleMenu}
        >
          <IconHelpCircle size={20} stroke={1.8} aria-hidden="true" />
        </IconButton>
        {hasDot && <span className={css.TopBarDot} data-help-tip-dot="true" aria-hidden="true" />}
        {helpMenu}
      </span>
    );
  }

  const renderButton = (tooltipAnchor: RefCallback<HTMLElement>) => (
    <SidebarAvatar
      ref={tooltipAnchor}
      as="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={!!menuButton}
      outlined
      onClick={toggleMenu}
      {...railMenuProps}
      data-menu-open={menuButton || railMenuProps?.['data-menu-open'] ? 'true' : undefined}
    >
      <IconHelpCircle size={20} stroke={menuButton ? 2.2 : 1.8} aria-hidden="true" />
    </SidebarAvatar>
  );

  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={label}>{renderButton}</SidebarItemTooltip>
      {hasDot && (
        <SidebarItemBadge>
          <span className={css.TipDot} data-help-tip-dot="true" aria-hidden="true" />
        </SidebarItemBadge>
      )}
      {helpMenu}
    </SidebarItem>
  );
}
