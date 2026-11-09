import { RefCallback } from 'react';
import { Icon, Icons } from 'folds';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../ui/sidebar/SidebarItem';
import { useThreadsNeedsYouCount } from '../../activity/useActivityRows';
import { ActivityBadge } from './ActivityTab';
import { useThreadsSelected } from '../../routes/useThreadsSelected';
import { getThreadsPath } from '../../routes/pathUtils';

type ThreadsTabProps = {
  /** Lets the navigation panel take the click, given whether Threads is shown; true when it did. */
  onSelect?: (selected: boolean) => boolean;
};

/** The Threads button of the icon rail: threads across every room, counting those that wait for you. */
export function ThreadsTab({ onSelect }: ThreadsTabProps) {
  const navigate = useNavigate();
  const active = useThreadsSelected();
  const { t } = useTranslation();
  const waiting = useThreadsNeedsYouCount();
  const label = waiting > 0 ? t('threadsPage.needsYouLabel', { count: waiting }) : t('nav.threads');

  const openThreads = () => {
    if (onSelect?.(active)) return;
    navigate(getThreadsPath());
  };

  const renderButton = (tooltipAnchor: RefCallback<HTMLElement>) => (
    <SidebarAvatar
      ref={tooltipAnchor}
      as="button"
      aria-label={label}
      outlined
      onClick={openThreads}
    >
      <Icon filled={active} src={Icons.Thread} />
    </SidebarAvatar>
  );

  return (
    <SidebarItem active={active}>
      <SidebarItemTooltip tooltip={t('nav.threads')}>{renderButton}</SidebarItemTooltip>
      {waiting > 0 && (
        <SidebarItemBadge hasCount>
          <ActivityBadge count={waiting} needsYou />
        </SidebarItemBadge>
      )}
    </SidebarItem>
  );
}
