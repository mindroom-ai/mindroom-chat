import { createContext, useContext } from 'react';
import type { NavToActivePathAtom } from '../navToActivePath';








  if (!navToActivePathAtom) {
    throw new Error('NavToActivePathAtom is missing; render inside NavToActivePathProvider.');
  }
  return navToActivePathAtom;
};
