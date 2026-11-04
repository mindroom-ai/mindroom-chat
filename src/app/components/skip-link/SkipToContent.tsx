import { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { firstTabbable } from '../../utils/overlayFocus';
import { PAGE_MAIN_ID } from '../page/Page';
import * as css from './SkipToContent.css';

/**
 * Where the skip link lands: the page's title, which screen readers then read, or else its first
 * control. Titles are not tabbable, so the title gets `tabindex="-1"` to take focus.
 */
const skipTarget = (doc: Document): HTMLElement | undefined => {
  const main = doc.getElementById(PAGE_MAIN_ID) ?? doc.querySelector('main');
  if (!main) return undefined;
  const title = main.querySelector<HTMLElement>('h1');
  if (title) {
    if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
    return title;
  }
  return firstTabbable(main);
};

/** The first stop of Tab on every signed-in screen; it jumps past the navigation to the page. */
export function SkipToContent() {
  const { t } = useTranslation();
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    skipTarget(event.currentTarget.ownerDocument)?.focus();
  };
  return (
    <a className={css.SkipLink} href={`#${PAGE_MAIN_ID}`} onClick={skip}>
      {t('sharedUi.a11y.skipToContent')}
    </a>
  );
}
