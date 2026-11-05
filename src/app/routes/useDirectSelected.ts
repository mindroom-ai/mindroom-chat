import { useMatch } from 'react-router-dom';
import { DIRECT_PATH } from './paths';

// A constant pattern object, so useMatch's memo holds between renders.
const DIRECT_PATTERN = { path: DIRECT_PATH, caseSensitive: true, end: false };

/** Whether the route is inside the Direct section. */
export const useDirectSelected = (): boolean => !!useMatch(DIRECT_PATTERN);
