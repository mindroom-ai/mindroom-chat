import { RefCallback } from 'react';
import { Icon, Icons } from 'folds';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { useThreadsSelected } from '../../../hooks/router/useThreadsSelected';
import { getThreadsPath } from '../../pathUtils';

type ThreadsTabProps = {
  /** Lets the navigation panel take the click, given whether Threads is shown; true when it did. */
  onSelect?: (selected: boolean) => boolean;
};

/** The Threads button of the icon rail: threads across every room. */
export function ThreadsTab({ onSelect }: ThreadsTabProps) {
  const navigate = useNavigate();
  const active = useThreadsSelected();
  const { t } = useTranslation();
  const label = t('nav.threads');

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
      <SidebarItemTooltip tooltip={label}>{renderButton}</SidebarItemTooltip>
    </SidebarItem>
  );
}
