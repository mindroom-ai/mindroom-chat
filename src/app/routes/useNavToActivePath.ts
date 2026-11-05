import { createContext, useContext } from 'react';
import type { NavToActivePathAtom } from './navToActivePath';

// Holds the signed-in user's last-route-per-section atom; undefined outside a provider.
const activePathContext = createContext<NavToActivePathAtom | undefined>(undefined);

export const NavToActivePathProvider = activePathContext.Provider;

/** The last-route-per-section atom from the nearest `NavToActivePathProvider`. */
export function useNavToActivePathAtom(): NavToActivePathAtom {
  const navToActivePathAtom = useContext(activePathContext);
  if (!navToActivePathAtom) {
    throw new Error('NavToActivePathAtom is missing; render inside NavToActivePathProvider.');
  }
  return navToActivePathAtom;
}
