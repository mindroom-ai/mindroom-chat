import { createContext, useContext } from 'react';
import type { ClosedNavCategoriesAtom } from './closedNavCategories';

// Holds the signed-in user's collapsed-category atom; undefined outside a provider.
const closedCategoriesContext = createContext<ClosedNavCategoriesAtom | undefined>(undefined);

export const ClosedNavCategoriesProvider = closedCategoriesContext.Provider;

/** The collapsed sidebar categories atom from the nearest `ClosedNavCategoriesProvider`. */
export function useClosedNavCategoriesAtom(): ClosedNavCategoriesAtom {
  const closedNavCategoriesAtom = useContext(closedCategoriesContext);
  if (!closedNavCategoriesAtom) {
    throw new Error(
      'ClosedNavCategoriesAtom is missing; render inside ClosedNavCategoriesProvider.'
    );
  }
  return closedNavCategoriesAtom;
}
