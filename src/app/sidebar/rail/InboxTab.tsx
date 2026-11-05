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
} from '../../ui/sidebar/SidebarItem';
import { UnreadBadge } from '../../ui/UnreadBadge';
import { useInboxSelected } from '../../routes/useInbox';
import { allInvitesAtom } from '../../matrix/state/inviteList';
import { getInboxInvitesPath } from '../../routes/pathUtils';

/** The Inbox button of the icon rail, with the number of pending invites. */
export function InboxTab() {
  const navigate = useNavigate();
  const active = useInboxSelected();
  const pendingInvites = useAtomValue(allInvitesAtom).length;
  const { t } = useTranslation();
  const label = t('nav.inbox');

  // The Inbox opens on Invites, also on phones, whose Back there leads to the Inbox list.
  const openInbox = () => navigate(getInboxInvitesPath());

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
