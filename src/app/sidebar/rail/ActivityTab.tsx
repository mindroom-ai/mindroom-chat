import { useState, type MouseEvent, type RefCallback } from 'react';
import { Badge, Icon, Icons, Text } from 'folds';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../ui/sidebar/SidebarItem';
import { UnreadBadge } from '../../ui/UnreadBadge';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { useActivitySelected } from '../../routes/useActivitySelected';
import { getActivityPath } from '../../routes/pathUtils';
import { useActivityBadge } from '../../activity/useActivityRows';
import { ActivityPopover } from '../../activity/ActivityPopover';

/** The bell's count: red while something waits for an answer, else the quiet unread chip. */
export function ActivityBadge({ count, needsYou }: { count: number; needsYou: boolean }) {
  if (!needsYou) return <UnreadBadge count={count} />;
  return (
    <Badge variant="Critical" fill="Solid" radii="Pill" size="400" data-activity-badge="needs-you">
      <Text as="span" size="L400">
        {count > 99 ? '99+' : count}
      </Text>
    </Badge>
  );
}

/**
 * The Activity bell of the icon rail. Wider than a phone it opens the Activity popover over the
 * page; a second click, or a click while Activity shows, opens the Activity page. On phones,
 * where the rail is in the drawer, it opens the page.
 */
type ActivityTabProps = {
  /** The navigation panel's handler of a section button; with false it shows a panel it hid. */
  onSelect?: (selected: boolean) => boolean;
};

export function ActivityTab({ onSelect }: ActivityTabProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const active = useActivitySelected();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const { count, needsYou } = useActivityBadge();
  const [anchor, setAnchor] = useState<HTMLElement>();
  const label = count > 0 ? t('activity.bellLabelCount', { count }) : t('activity.bellLabel');

  const openPage = () => {
    setAnchor(undefined);
    // The page's list is the navigation panel, so a hidden panel shows again.
    onSelect?.(false);
    navigate(getActivityPath());
  };
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (phone || active || anchor) openPage();
    else setAnchor(event.currentTarget);
  };

  const renderButton = (tooltipAnchor: RefCallback<HTMLElement>) => (
    <SidebarAvatar
      ref={tooltipAnchor}
      as="button"
      aria-label={label}
      aria-haspopup={phone ? undefined : 'dialog'}
      aria-expanded={phone ? undefined : !!anchor}
      outlined
      onClick={onClick}
    >
      <Icon filled={active || !!anchor} src={Icons.Bell} />
    </SidebarAvatar>
  );

  return (
    <SidebarItem active={active}>
      <SidebarItemTooltip tooltip={t('activity.bellLabel')}>{renderButton}</SidebarItemTooltip>
      {count > 0 && (
        <SidebarItemBadge hasCount>
          <ActivityBadge count={count} needsYou={needsYou} />
        </SidebarItemBadge>
      )}
      {anchor && (
        <ActivityPopover anchor={anchor} onClose={() => setAnchor(undefined)} onExpand={openPage} />
      )}
    </SidebarItem>
  );
}
