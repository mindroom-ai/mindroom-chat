import { MouseEventHandler, useCallback } from 'react';

/** The actions the closed-navigation-categories atom accepts. */
export type CategoryAction =
  | { type: 'PUT'; categoryId: string }
  | { type: 'DELETE'; categoryId: string };

/**
 * A click handler for collapsible navigation categories: reads the category ID from the
 * clicked element's `data-category-id` and opens or closes that category.
 */
export const useCategoryHandler = (
  setClosed: (action: CategoryAction) => void,
  isClosed: (categoryId: string) => boolean
): MouseEventHandler<HTMLElement> =>
  useCallback(
    (event) => {
      const categoryId = event.currentTarget.getAttribute('data-category-id');
      if (!categoryId) return;
      setClosed({ type: isClosed(categoryId) ? 'DELETE' : 'PUT', categoryId });
    },
    [setClosed, isClosed]
  );
