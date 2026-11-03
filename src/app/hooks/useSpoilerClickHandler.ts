import { MouseEventHandler, useCallback } from 'react';

/**
 * The click handler for spoilers (`data-mx-spoiler`): the first click reveals the text by
 * toggling `aria-pressed`; clicks on a revealed spoiler pass through to links inside it.
 */
export const useSpoilerClickHandler = (): MouseEventHandler<HTMLElement> =>
  useCallback((event) => {
    const target = event.currentTarget;
    if (target.getAttribute('aria-pressed') === 'true') return;
    event.preventDefault();
    event.stopPropagation();
    target.setAttribute('aria-pressed', 'true');
  }, []);
