import { RefCallback } from 'react';
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
import { getInboxNotificationsPath, getInboxPath } from '../../pathUtils';

/** The Inbox button of the icon rail, with the number of pending invites. */
export function InboxTab() {
  const navigate = useNavigate();
  const onPhone = useScreenSizeContext() === ScreenSize.Mobile;
  const active = useInboxSelected();
  const pendingInvites = useAtomValue(allInvitesAtom).length;
  const { t } = useTranslation();
  const label = t('nav.inbox');

  // Phones open the Inbox section list; wider screens go straight to the notifications.
  const openInbox = () => navigate(onPhone ? getInboxPath() : getInboxNotificationsPath());

  const renderButton = (tooltipAnchor: RefCallback<HTMLElement>) => (
    <SidebarAvatar ref={tooltipAnchor} as="button" aria-label={label} outlined onClick={openInbox}>
      <Icon filled={active} src={Icons.Inbox} />
    </SidebarAvatar>
  );

  return (
    <SidebarItem active={active}>
      <SidebarItemTooltip tooltip={label}>{renderButton}</SidebarItemTooltip>
      {pendingInvites === 0 ? null : (
        <SidebarItemBadge hasCount>
          <UnreadBadge count={pendingInvites} highlight />
        </SidebarItemBadge>
      )}
    </SidebarItem>
  );
}
