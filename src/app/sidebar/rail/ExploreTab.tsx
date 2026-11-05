import React from 'react';
import { Icon, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../ui/sidebar';
import { useExploreSelected } from '../../routes/useExploreSelected';
import { useOpenExplore } from './useOpenExplore';

type ExploreTabProps = {
  /** Lets the navigation panel take the click; return true when it did. */
  onSelect?: (selected: boolean) => boolean;
};

/** The Explore button of the icon rail. */
export function ExploreTab({ onSelect }: ExploreTabProps) {
  const { t } = useTranslation();
  const selected = useExploreSelected();
  const openExplore = useOpenExplore();

  const handleClick = () => {
    if (onSelect?.(selected)) return;
    openExplore();
  };

  const label = t('nav.exploreCommunity');
  const exploreIcon = <Icon src={Icons.Explore} filled={selected} />;
  const renderTrigger = (ref: React.Ref<HTMLButtonElement>) => (
    <SidebarAvatar as="button" ref={ref} outlined aria-label={label} onClick={handleClick}>
      {exploreIcon}
    </SidebarAvatar>
  );

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={label}>{renderTrigger}</SidebarItemTooltip>
    </SidebarItem>
  );
}
