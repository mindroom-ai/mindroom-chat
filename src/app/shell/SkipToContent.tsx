import { MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { phoneNavDrawerOpenAtom, phoneSheetOpenAtom } from '../navigation/phoneNavDrawer';
import { phoneDrawerOpenAtom } from '../members/useMembersDrawer';
import { PAGE_MAIN_ID } from '../ui/page/Page';
import { mainContentFocusTarget } from '../ui/page/mainContentFocus';
import * as css from './SkipToContent.css';

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
    mainContentFocusTarget(doc)?.focus();
  };
  return (
    <a className={css.SkipLink} href={`#${PAGE_MAIN_ID}`} onClick={skip}>
      {t('sharedUi.a11y.skipToContent')}
    </a>
  );
}
