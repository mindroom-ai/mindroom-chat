import { useMatch } from 'react-router-dom';
import { INBOX_PATH } from './paths';

// A constant pattern object, so useMatch's memo holds between renders.
const INBOX_PATTERN = { path: INBOX_PATH, caseSensitive: true, end: false };

/** Whether the route is inside the Inbox section. */
export const useInboxSelected = (): boolean => !!useMatch(INBOX_PATTERN);
