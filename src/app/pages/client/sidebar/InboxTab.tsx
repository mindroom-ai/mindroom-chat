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
import { useInboxSelected } from '../../../hooks/router/useInbox';
import { allInvitesAtom } from '../../../state/room-list/inviteList';
import { getInboxInvitesPath, getInboxPath } from '../../pathUtils';

/** The Inbox button of the icon rail, with the number of pending invites. */




  const selected = useInboxSelected();
  const invites = useAtomValue(allInvitesAtom);

  const handleClick = () => {
    navigate(screenSize === ScreenSize.Mobile ? getInboxPath() : getInboxInvitesPath());
  };

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={t('nav.inbox')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('nav.inbox')}
            onClick={handleClick}
          >
            <Icon src={Icons.Inbox} filled={selected} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {invites.length > 0 && (
        <SidebarItemBadge hasCount>
          <UnreadBadge highlight count={invites.length} />
        </SidebarItemBadge>
      )}
    </SidebarItem>
  );
}
