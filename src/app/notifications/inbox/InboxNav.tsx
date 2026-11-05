import { Avatar, Box, Icon, Icons, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { useMatch } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageNav, PageNavContent, PageNavHeader } from '../../ui/page/Page';
import { NavCategory, NavItem, NavItemContent, NavLink } from '../../ui/nav/NavItem';
import { NavPageLink } from '../../ui/nav/NavPageLink';
import { UnreadBadge, UnreadBadgeCenter } from '../../ui/UnreadBadge';
import { allInvitesAtom } from '../../matrix/state/inviteList';
import { INBOX_INVITES_PATH, INBOX_NOTIFICATIONS_PATH } from '../../routes/paths';
import { getInboxInvitesPath, getInboxNotificationsPath } from '../../routes/pathUtils';

/** The Invites row, with the number of pending invites at its end as the rail's Inbox shows it. */
function InvitesNavLink({ selected }: { selected: boolean }) {
  const { t } = useTranslation();
  const pendingInvites = useAtomValue(allInvitesAtom).length;
  return (
    <NavItem variant="Background" radii="400" aria-selected={selected}>
      <NavLink to={getInboxInvitesPath()} aria-current={selected ? 'page' : undefined}>
        <NavItemContent>
          <Box as="span" grow="Yes" gap="200" alignItems="Center">
            <Avatar size="200" radii="400">
              <Icon src={Icons.Mail} size="100" filled={selected} />
            </Avatar>
            <Text as="span" size="Inherit" truncate style={{ flexGrow: 1 }}>
              {t('sharedUi.inbox.invites')}
            </Text>
            {pendingInvites > 0 && (
              <UnreadBadgeCenter>
                <UnreadBadge count={pendingInvites} highlight />
              </UnreadBadgeCenter>
            )}
          </Box>
        </NavItemContent>
      </NavLink>
    </NavItem>
  );
}

/**
 * The Inbox navigation: the invites waiting for an answer first, where the Inbox opens, then the
 * notifications.
 */
export function InboxNav() {
  const { t } = useTranslation();
  const onInvites = useMatch({ path: INBOX_INVITES_PATH, end: false }) !== null;
  const onNotifications = useMatch({ path: INBOX_NOTIFICATIONS_PATH, end: false }) !== null;

  return (
    <PageNav label={t('sharedUi.inbox.inbox')}>
      <PageNavContent
        header={
          <PageNavHeader>
            <Box grow="Yes">
              <Text as="h2" size="H4" truncate>
                {t('sharedUi.inbox.inbox')}
              </Text>
            </Box>
          </PageNavHeader>
        }
      >
        <NavCategory>
          <InvitesNavLink selected={onInvites} />
          <NavPageLink
            to={getInboxNotificationsPath()}
            icon={Icons.MessageUnread}
            label={t('sharedUi.inbox.notifications')}
            selected={onNotifications}
          />
        </NavCategory>
      </PageNavContent>
    </PageNav>
  );
}
