import { createContext, useContext } from 'react';
import type { ClosedNavCategoriesAtom } from '../closedNavCategories';








  if (!closedNavCategoriesAtom) {
    throw new Error(
      'ClosedNavCategoriesAtom is missing; render inside ClosedNavCategoriesProvider.'
    );
  }
  return closedNavCategoriesAtom;
};
