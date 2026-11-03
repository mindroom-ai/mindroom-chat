import React from 'react';
import { Icon, Icons } from 'folds';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../../components/sidebar';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { useExploreSelected } from '../../../hooks/router/useExploreSelected';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';
import { getMxIdServer } from '../../../utils/matrix';
import {
  getExploreFeaturedPath,
  getExplorePath,
  getExploreServerPath,
  joinPathComponent,
} from '../../pathUtils';

type ExploreTabProps = {
  /** Lets the navigation panel take the click; return true when it did. */
  onSelect?: (selected: boolean) => boolean;
};

/** The Explore button of the icon rail. */
export function ExploreTab({ onSelect }: ExploreTabProps) {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useScreenSizeContext() === ScreenSize.Mobile;
  const { featuredCommunities } = useClientConfig();
  const selected = useExploreSelected();
  const navToActivePath = useAtomValue(useNavToActivePathAtom());

  const handleClick = () => {
    if (onSelect?.(selected)) return;
    if (isMobile) {
      navigate(getExplorePath());
      return;
    }
    const lastPath = navToActivePath.get('explore');
    if (lastPath) {
      navigate(joinPathComponent(lastPath));
      return;
    }
    if (featuredCommunities?.openAsDefault) {
      navigate(getExploreFeaturedPath());
      return;
    }
    const server = getMxIdServer(client.getUserId() ?? '');
    navigate(server ? getExploreServerPath(server) : getExploreFeaturedPath());
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
