import {
  useCallback,
  useState,
  type CSSProperties,
  type MouseEvent,
  type RefCallback,
} from 'react';
import { IconButton, color } from 'folds';
import { IconHelpCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { HelpMenu } from '../../tour/HelpMenu';
import { useContextualTip } from '../../tour/useContextualTip';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../ui/sidebar/SidebarItem';

const TIP_DOT_STYLE: CSSProperties = {
  display: 'block',
  inlineSize: '10px',
  blockSize: '10px',
  borderRadius: '9999px',
  backgroundColor: color.Primary.Main,
  boxShadow: `0 0 0 2px ${color.Background.Container}`,
};

const TOP_BAR_FRAME_STYLE: CSSProperties = {
  position: 'relative',
  flexShrink: 0,
  display: 'inline-flex',
};

const TOP_BAR_DOT_STYLE: CSSProperties = {
  ...TIP_DOT_STYLE,
  position: 'absolute',
  insetBlockStart: '4px',
  insetInlineEnd: '4px',
  pointerEvents: 'none',
};

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
  const toggleMenu = (event: MouseEvent<HTMLElement>) => {
    const button = event.currentTarget;
    setMenuButton((open) => (open ? undefined : button));
  };

  const hasDot = tip !== undefined && !menuButton;
  const label = tip ? t('tour.help.buttonWithTip') : t('tour.help.button');
  const helpMenu = menuButton && (
    <HelpMenu anchor={menuButton} below={inTopBar} onClose={closeMenu} />
  );

  if (inTopBar) {
    return (
      <span style={TOP_BAR_FRAME_STYLE}>
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
        {hasDot && <span style={TOP_BAR_DOT_STYLE} data-help-tip-dot="true" aria-hidden="true" />}
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
      data-menu-open={menuButton ? 'true' : undefined}
      outlined
      onClick={toggleMenu}
    >
      <IconHelpCircle size={20} stroke={menuButton ? 2.2 : 1.8} aria-hidden="true" />
    </SidebarAvatar>
  );

  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip={label}>{renderButton}</SidebarItemTooltip>
      {hasDot && (
        <SidebarItemBadge>
          <span style={TIP_DOT_STYLE} data-help-tip-dot="true" aria-hidden="true" />
        </SidebarItemBadge>
      )}
      {helpMenu}
    </SidebarItem>
  );
}
