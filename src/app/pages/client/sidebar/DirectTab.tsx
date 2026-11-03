import React from 'react';
import { Icon, Icons } from 'folds';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../../components/sidebar';
import { UnreadBadge } from '../../../components/unread-badge';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { useDirectSelected } from '../../../hooks/router/useDirectSelected';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';
import { mDirectAtom } from '../../../state/mDirectList';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { getDirectPath, joinPathComponent } from '../../pathUtils';

type DirectTabProps = {
  onSelect?: (selected: boolean) => boolean;
};

/** The Direct Messages button of the icon rail. */
export function DirectTab({ onSelect }: DirectTabProps) {



  const selected = useDirectSelected();
  const navToActivePath = useAtomValue(useNavToActivePathAtom());
  const directs = useAtomValue(mDirectAtom);
  const unread = useRoomsUnread(Array.from(directs), roomToUnreadAtom);

  const handleClick = () => {
    if (onSelect?.(selected)) return;
    const lastPath = navToActivePath.get('direct');
    if (screenSize === ScreenSize.Mobile && !selected) {
      navigate(getDirectPath());
      return;
    }
    navigate(lastPath ? joinPathComponent(lastPath) : getDirectPath());
  };

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={t('featureUi.sidebar.direct')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('featureUi.sidebar.direct')}
            onClick={handleClick}
          >







        </SidebarItemBadge>
      )}
    </SidebarItem>
  );
}
