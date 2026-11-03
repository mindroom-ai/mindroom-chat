import { useMatch } from 'react-router-dom';
import { DIRECT_PATH } from '../../pages/paths';

/** Whether the route is inside the Direct section. */
export const useDirectSelected = (): boolean =>
  !!useMatch({ path: DIRECT_PATH, caseSensitive: true, end: false });
