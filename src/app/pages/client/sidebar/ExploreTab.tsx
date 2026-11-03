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





  const selected = useExploreSelected();
  const navToActivePath = useAtomValue(useNavToActivePathAtom());

  const handleClick = () => {
    if (onSelect?.(selected)) return;
    if (screenSize === ScreenSize.Mobile) {
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
    const server = getMxIdServer(mx.getUserId() ?? '');
    navigate(server ? getExploreServerPath(server) : getExploreFeaturedPath());
  };

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={t('featureUi.sidebar.explore')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('featureUi.sidebar.explore')}
            onClick={handleClick}
          >
            <Icon src={Icons.Explore} filled={selected} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
