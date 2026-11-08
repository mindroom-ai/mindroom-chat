import { firstTabbable } from '../../lib/overlayFocus';
import { PAGE_MAIN_ID } from './Page';

/**
 * Where the focus lands on the page itself (the skip link, a floating view that closed): the
 * page's title, which screen readers then read, or else its first control. Titles are not
 * tabbable, so the title gets `tabindex="-1"` to take focus. A title out of reach, as a room's
 * under a side panel in the conversation's place, does not count.
 */
export const mainContentFocusTarget = (doc: Document): HTMLElement | undefined => {
  const main = doc.getElementById(PAGE_MAIN_ID) ?? doc.querySelector('main');
  if (!main) return undefined;
  const title = Array.from(main.querySelectorAll<HTMLElement>('h1')).find(
    (heading) => !heading.closest('[inert]')
  );
  if (title) {
    if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
    return title;
  }
  return firstTabbable(main);
};
