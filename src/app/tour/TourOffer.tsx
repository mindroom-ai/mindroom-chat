import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue } from 'jotai';
import { Button, Icon, IconButton, Icons, Text } from 'folds';
import { useClientConfig } from '../config/useClientConfig';
import { useForceUpdate } from '../lib/hooks/useForceUpdate';
import { useAccountData } from '../matrix/hooks/useAccountData';
import { useSetAccountSettings } from '../matrix/hooks/useAccountSettings';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useSyncedWithServer } from '../matrix/hooks/useSyncedWithServer';
import { PHONE_SLIDE_OUT_MS, phoneLayerOpenAtom } from '../navigation/phoneNavDrawer';
import { tourAtom, type TourLevel } from '../navigation/tourState';
import {
  MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
  sanitizeAccountSettings,
} from '../preferences/accountSettings';
import { Surface } from '../ui/glass/GlassPrimitives';
import { listNoticeSlotAtom, pageNoticeSlotAtom, useNoticePresence } from '../ui/noticeSlots';
import * as css from './TourOffer.css';

// Accounts that answered the offer since the app started, so that one switched away from and back
// to is not asked again while its stored answer is on its way; a page load starts it over.
const answeredAccounts = new Set<string>();

/** Forgets which accounts answered, as a page load does. */
export const resetAnsweredAccountsForTests = () => answeredAccounts.clear();

/**
 * Offers the interface tour, in a Quick and a Full level, on a card where the new version notice
 * shows (ui/noticeSlots.tsx): at the foot of the room list while there is one beside the page,
 * else at the top of the page. It shows once the client has synced with its server, until the
 * account answers: with one of the card's buttons, or by opening the tour from anywhere else. The
 * answer is kept for the life of the page and stored as `tourOffered` in the account's
 * `io.mindroom.settings`, so no other start or device asks again. `tour.offerAtStart: false`
 * turns the offer off.
 */
export function TourOffer() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const userId = mx.getSafeUserId();
  // Not the stored copy of the last session, which a start shows first: its account data may
  // lack the answer another device gave since, or the settings a write here would replace.
  const synced = useSyncedWithServer(mx);
  const offerAtStart = useClientConfig().tour?.offerAtStart !== false;
  // The event itself, which the client holds from the start, so no render is without it.
  const settings = useAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE);
  const stored = sanitizeAccountSettings(settings?.getContent()).tourOffered;
  const setAccountSettings = useSetAccountSettings();
  const [tour, setTour] = useAtom(tourAtom);
  const tourOpen = tour !== undefined;
  const [, refresh] = useForceUpdate();
  const answered = tourOpen || answeredAccounts.has(userId);

  // The tour opened from anywhere, the card or another entry, is an answer.
  useEffect(() => {
    if (tourOpen) answeredAccounts.add(userId);
  }, [tourOpen, userId]);

  // Stores the answer, never before the client has synced with its server: the write goes over
  // the stored settings, and before they have arrived it would replace the account's other
  // settings. A refused write is left alone: the card stays away for this page, and the next
  // start asks again.
  useEffect(() => {
    if (!answered || !synced || stored) return;
    setAccountSettings({ tourOffered: true }).catch(() => undefined);
  }, [answered, synced, stored, setAccountSettings]);

  // The card shows only in a place of the layout, so it is due only once one is offered: a place
  // that comes after the offer, under a phone's drawer, holds the card back like any other.
  const listSlot = useAtomValue(listNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const hasPlace = listSlot !== null || pageSlot !== null;
  const phoneLayerOpen = useAtomValue(phoneLayerOpenAtom);
  const { shown, slot, placement, leaving, settled, dismiss, onAnimationEnd } = useNoticePresence(
    synced && offerAtStart && !stored && !answered && hasPlace,
    { open: phoneLayerOpen, slideOutMs: PHONE_SLIDE_OUT_MS }
  );
  if (!shown || !slot) return null;

  /** Answers the offer and plays the card out; with a level, opens the tour. */
  const answer = (level?: TourLevel) => {
    answeredAccounts.add(userId);
    refresh();
    dismiss();
    if (level) setTour({ level });
  };

  const layout = placement === 'list' || slot.hasAttribute('data-phone') ? 'stacked' : 'row';
  return createPortal(
    <Surface
      className={css.Card({ placement, layout })}
      data-tour-offer={placement}
      data-leaving={leaving || undefined}
      data-settled={settled || undefined}
      onAnimationEnd={onAnimationEnd}
    >
      <span className={css.Mark({ layout })} aria-hidden>
        <Icon src={Icons.Explore} size="100" />
      </span>
      <div className={css.Body({ layout })}>
        <div className={css.Words({ layout })}>
          <Text as="div" size="T300" className={css.Title}>
            {t('tour.offer.title')}
          </Text>
          <Text as="div" size="T200" priority="300">
            {t('tour.offer.text')}
          </Text>
        </div>
        <div className={css.Actions({ layout })}>
          <Button
            className={css.Action({ layout })}
            size="300"
            radii="300"
            variant="Primary"
            fill="Solid"
            data-tour-offer-action="quick"
            onClick={() => answer('quick')}
          >
            <Text as="span" size="B300" truncate>
              {t('tour.offer.quick')}
            </Text>
          </Button>
          <Button
            className={css.Action({ layout })}
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            data-tour-offer-action="full"
            onClick={() => answer('full')}
          >
            <Text as="span" size="B300" truncate>
              {t('tour.offer.full')}
            </Text>
          </Button>
        </div>
      </div>
      <IconButton
        className={css.Dismiss({ layout })}
        variant="Secondary"
        fill="None"
        size="300"
        radii="300"
        aria-label={t('tour.offer.dismiss')}
        data-tour-offer-action="dismiss"
        onClick={() => answer()}
      >
        <Icon src={Icons.Cross} size="100" />
      </IconButton>
    </Surface>,
    slot
  );
}
