import React from 'react';
import { Box, Icons, Text } from 'folds';
import { useMatch } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import { NavCategory } from '../../../components/nav';
import { NavPageLink } from '../../../components/nav/NavPageLink';
import { INBOX_INVITES_PATH, INBOX_NOTIFICATIONS_PATH } from '../../paths';
import { getInboxInvitesPath, getInboxNotificationsPath } from '../../pathUtils';

/** The Inbox navigation: the invites waiting for an answer and the notifications. */
export function InboxNav() {
  const { t } = useTranslation();
  const onInvites = useMatch({ path: INBOX_INVITES_PATH, end: false }) !== null;
  const onNotifications = useMatch({ path: INBOX_NOTIFICATIONS_PATH, end: false }) !== null;

  return (
    <PageNav>
      <PageNavContent
        header={
          <PageNavHeader>
            <Box grow="Yes">
              <Text size="H4" truncate>
                {t('sharedUi.inbox.inbox')}
              </Text>
            </Box>
          </PageNavHeader>
        }
      >
        <NavCategory>
          <NavPageLink
            to={getInboxInvitesPath()}
            icon={Icons.Mail}
            label={t('sharedUi.inbox.invites')}
            selected={onInvites}
          />
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
