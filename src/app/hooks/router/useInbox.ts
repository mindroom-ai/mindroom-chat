import { useMatch } from 'react-router-dom';
import { INBOX_INVITES_PATH, INBOX_NOTIFICATIONS_PATH, INBOX_PATH } from '../../pages/paths';

/** Whether the route is inside the Inbox section. */
export const useInboxSelected = (): boolean =>
  !!useMatch({ path: INBOX_PATH, caseSensitive: true, end: false });

export const useInboxNotificationsSelected = (): boolean =>
  !!useMatch({ path: INBOX_NOTIFICATIONS_PATH, caseSensitive: true, end: false });

export const useInboxInvitesSelected = (): boolean =>
  !!useMatch({ path: INBOX_INVITES_PATH, caseSensitive: true, end: false });
