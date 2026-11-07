import { type AnimationEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { Button, Icon, IconButton, Icons, Text } from 'folds';
import { getNewVersion, reloadForNewVersion, subscribeToNewVersion } from '../config/appUpdate';
import { PHONE_SLIDE_OUT_MS, phoneLayerOpenAtom } from '../navigation/phoneNavDrawer';
import { listNoticeSlotAtom, pageNoticeSlotAtom } from '../ui/noticeSlots';
import { PageSlot } from '../ui/noticeSlots.css';
import { Surface } from '../ui/glass/GlassPrimitives';
import * as css from './NewVersionNotice.css';

type Placement = 'list' | 'page';

/** How long a dismissed card takes to leave: the Normal motion token, and a frame to spare. */
export const LEAVE_MS = 180;

/** The new version the server publishes, if the page found one (src/app/config/appUpdate.ts). */
export const useNewVersion = (): string | undefined =>
  useSyncExternalStore(subscribeToNewVersion, getNewVersion);

/**
 * "A new version is available" with a Reload action, on a card that floats over every screen
 * without moving it. Signed in, it takes a place the layout offers (ui/noticeSlots.tsx): the foot
 * of the room list while there is one beside the page, else the top of the page. Signed out, it
 * floats over the top of the app. It appears once the server publishes another build than this
 * page's, found when the page starts, when a part fails to load, when the page is shown again, or
 * by a check every five minutes (src/app/config/appUpdate.ts); dismissed, it plays its way out
 * and stays away for the life of the page.
 */
export function NewVersionNotice() {
  const { t } = useTranslation();
  const version = useNewVersion();
  const listSlot = useAtomValue(listNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const phoneLayerOpen = useAtomValue(phoneLayerOpenAtom);
  const [dismissed, setDismissed] = useState(false);
  // Dismissed, the card leaves from where it was, even if the list closes meanwhile.
  const [leftFrom, setLeftFrom] = useState<{ slot: HTMLElement | null; placement: Placement }>();
  const [reloading, setReloading] = useState(false);
  const leaving = leftFrom !== undefined;
  const slot = leftFrom ? leftFrom.slot : listSlot ?? pageSlot;
  const placement: Placement = leftFrom?.placement ?? (listSlot ? 'list' : 'page');
  // The card comes in once where it is placed: rebuilt in a new place of the same kind (the list
  // of another section), it shows at once instead of arriving again.
  const cameInAt = useRef<Placement>();
  const settled = cameInAt.current === placement;
  // A phone's drawer or members sheet covers the page's place and makes it inert, where an
  // assistive technology would not read the card out. Found meanwhile, the card waits until they
  // have slid away, so the place is a live region again before the card is added to it, and then
  // stays (under them, inert, should they come back).
  const covered = phoneLayerOpen && !listSlot && pageSlot?.hasAttribute('data-phone') === true;
  const due = version !== undefined && !dismissed;
  const [cameIn, setCameIn] = useState(false);
  const [heldBack, setHeldBack] = useState(false);
  if (due && !cameIn && !heldBack) {
    if (covered) setHeldBack(true);
    else setCameIn(true);
  }
  useEffect(() => {
    if (!heldBack || covered || cameIn) return undefined;
    const timer = window.setTimeout(() => setCameIn(true), PHONE_SLIDE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [heldBack, covered, cameIn]);
  const shown = due && cameIn;

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => {
      setDismissed(true);
      // Gone for good: let go of the place it left from.
      setLeftFrom(undefined);
    }, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const reload = () => {
    setReloading(true);
    reloadForNewVersion().catch(() => setReloading(false));
  };

  const card = shown && (
    <Surface
      className={css.Card({ placement })}
      data-new-version-card={placement}
      data-leaving={leaving || undefined}
      data-settled={settled || undefined}
      onAnimationEnd={(event: AnimationEvent<HTMLElement>) => {
        if (event.target === event.currentTarget && !leaving) cameInAt.current = placement;
      }}
    >
      <span className={css.Mark({ placement })} aria-hidden>
        <Icon src={Icons.Download} size="100" />
      </span>
      <div className={css.Body({ placement })}>
        <Text as="div" size="T300" className={css.Text({ placement })}>
          {t('sharedUi.appUpdate.available')}
        </Text>
        <Button
          className={css.Action({ placement })}
          size="300"
          radii="300"
          variant="Primary"
          fill="Solid"
          before={<Icon src={Icons.Reload} size="50" />}
          disabled={reloading}
          onClick={reload}
        >
          <Text as="span" size="B300">
            {t('sharedUi.appUpdate.reload')}
          </Text>
        </Button>
      </div>
      <IconButton
        className={css.Dismiss({ placement })}
        variant="Secondary"
        fill="None"
        size="300"
        radii="300"
        aria-label={t('sharedUi.appUpdate.dismiss')}
        onClick={() => setLeftFrom({ slot, placement })}
      >
        <Icon src={Icons.Cross} size="100" />
      </IconButton>
    </Surface>
  );

  // Signed out there is no place to take: the card floats from the notice's own region at the top
  // of the app's content box (NoticeLayout), which takes no room. The region stays in the page, so
  // the notice is announced when it appears; the layout's places are live regions too. It has no
  // status role: the operator notices' stack is the page's status region.
  return (
    <div aria-live="polite" className={css.Region} data-new-version-notice>
      {slot
        ? card && createPortal(card, slot)
        : card && <div className={PageSlot({ phone: false })}>{card}</div>}
    </div>
  );
}
