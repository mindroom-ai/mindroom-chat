import { MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { phoneNavDrawerOpenAtom, phoneSheetOpenAtom } from '../navigation/phoneNavDrawer';
import { phoneDrawerOpenAtom } from '../members/useMembersDrawer';
import { firstTabbable } from '../lib/overlayFocus';
import { PAGE_MAIN_ID } from '../ui/page/Page';
import * as css from './SkipToContent.css';

/**
 * Where the skip link lands: the page's title, which screen readers then read, or else its first
 * control. Titles are not tabbable, so the title gets `tabindex="-1"` to take focus. A title out of
 * reach, as a room's under a side panel in the conversation's place, does not count.
 */
const skipTarget = (doc: Document): HTMLElement | undefined => {
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

/** The first stop of Tab on every signed-in screen; it jumps past the navigation to the page. */
export function SkipToContent() {
  const { t } = useTranslation();
  const setNavDrawerOpen = useSetAtom(phoneNavDrawerOpenAtom);
  const setMembersOverPage = useSetAtom(phoneDrawerOpenAtom);
  const setSheetOpen = useSetAtom(phoneSheetOpenAtom);
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const doc = event.currentTarget.ownerDocument;
    // A phone's open navigation drawer or members sheet leaves the page inert: put them away
    // before the focus moves.
    flushSync(() => {
      setNavDrawerOpen(false);
      setMembersOverPage({});
      setSheetOpen(false);
    });
    skipTarget(doc)?.focus();
  };
  return (
    <a className={css.SkipLink} href={`#${PAGE_MAIN_ID}`} onClick={skip}>
      {t('sharedUi.a11y.skipToContent')}
    </a>
  );
}
