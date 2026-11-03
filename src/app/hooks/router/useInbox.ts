import { useMatch } from 'react-router-dom';
import { INBOX_PATH } from '../../pages/paths';

/** Whether the route is inside the Inbox section. */
export const useInboxSelected = (): boolean =>
  !!useMatch({ path: INBOX_PATH, caseSensitive: true, end: false });
