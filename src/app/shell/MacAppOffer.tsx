import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { Button, Icon, IconButton, Icons, Text } from 'folds';
import { useClientConfig } from '../config/useClientConfig';
import { useAccountData } from '../matrix/hooks/useAccountData';
import { useSetAccountSettings } from '../matrix/hooks/useAccountSettings';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useServerSyncApplied } from '../matrix/hooks/useServerSyncApplied';
import { createSessionId } from '../matrix/session/sessions';
import { MacAppIcon } from '../native/MacAppIcon';
import { MAC_APP_DOWNLOAD_URL, useOffersMacApp } from '../native/macApp';
import { PHONE_SLIDE_OUT_MS, phoneLayerOpenAtom } from '../navigation/phoneNavDrawer';
import { tourAtom, tourOfferAnsweredAtom } from '../navigation/tourState';
import {
  MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
  sanitizeAccountSettings,
} from '../preferences/accountSettings';
import { Surface } from '../ui/glass/GlassPrimitives';
import { listNoticeSlotAtom, pageNoticeSlotAtom, useNoticePresence } from '../ui/noticeSlots';
import * as css from './MacAppOffer.css';

// Accounts (session IDs) that answered the offer since the app started, so that one switched away
// from and back to is not asked again while its stored answer is on its way; a page load starts it
// over.
const answeredAccounts = new Set<string>();

/** Forgets which accounts answered, as a page load does. */
export const resetAnsweredMacAppAccountsForTests = () => answeredAccounts.clear();

/**
 * Offers the Mac app in a browser on a Mac, where the deployment turns it on (`macApp.offer`), on
 * a card where the tour's offer shows (tour/TourOffer.tsx): at the foot of the room list while
 * there is one beside the page, else at the top of the page in one line, which wraps in a narrow
 * window. It shows once the client has synced with its server, until the account answers with any
 * of the card's buttons, Download included; the answer is kept for the life of the page and stored
 * as `macAppOffered` in the account's `io.mindroom.settings`, so no other start or device asks
 * again. It waits while the tour's offer is due, so a first sign-in gets one offer at a time, and
 * while a tour is open. The Home menu and Settings, About, keep a way to the download.
 */
export function MacAppOffer() {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const offered = useOffersMacApp();
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
  // Not the stored copy of the last session, which a start shows first: its account data may
  // lack the answer another device gave since, or the settings a write here would replace.
  const synced = useServerSyncApplied(mx);
  const tourOfferedAtStart = useClientConfig().tour?.offerAtStart !== false;
  const settings = sanitizeAccountSettings(
    useAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE)?.getContent()
  );
  const stored = settings.macAppOffered;
  // The tour's offer goes first: until the account has answered it, stored or on this page (a
  // refused write included), this one waits, and it does not come over a tour that is open.
  const tourOpen = useAtomValue(tourAtom) !== undefined;
  const tourAnsweredHere = useAtomValue(tourOfferAnsweredAtom).has(sessionId);
  const tourAnswered = settings.tourOffered || tourAnsweredHere;
  const tourFirst = (tourOfferedAtStart && !tourAnswered) || tourOpen;
  const setAccountSettings = useSetAccountSettings();
  const answered = answeredAccounts.has(sessionId);

  // Stores the answer, never before the client has synced with its server: the write goes over
  // the stored settings, and before they have arrived it would replace the account's other
  // settings. A refused write is left alone: the card stays away for this page, and the next
  // start asks again.
  useEffect(() => {
    if (!answered || !synced || stored) return;
    setAccountSettings({ macAppOffered: true }).catch(() => undefined);
  }, [answered, synced, stored, setAccountSettings]);

  const listSlot = useAtomValue(listNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const hasPlace = listSlot !== null || pageSlot !== null;
  const phoneLayerOpen = useAtomValue(phoneLayerOpenAtom);
  const { shown, slot, placement, leaving, settled, dismiss, onAnimationEnd } = useNoticePresence(
    offered && synced && !stored && !answered && !tourFirst && hasPlace,
    { open: phoneLayerOpen, slideOutMs: PHONE_SLIDE_OUT_MS }
  );
  if (!shown || !slot) return null;

  /** Answers the offer and plays the card out. */
  const answer = () => {
    answeredAccounts.add(sessionId);
    // Leaving is a change of state, so the render that follows reads the answer.
    dismiss();
  };

  const download = (label: string, action: string) => (
    <Button
      as="a"
      className={css.Download}
      href={MAC_APP_DOWNLOAD_URL}
      target="_blank"
      rel="noreferrer noopener"
      size="300"
      radii="300"
      variant="Primary"
      fill="Solid"
      before={<Icon src={Icons.Download} size="50" />}
      data-mac-app-offer-action={action}
      onClick={answer}
    >
      <Text as="span" size="B300" truncate>
        {label}
      </Text>
    </Button>
  );

  // The page's place, a narrow window's included, gets the one line, which wraps when it must.
  const layout = placement === 'list' ? 'stacked' : 'row';
  return createPortal(
    <Surface
      className={css.Card({ placement, layout })}
      data-mac-app-offer={placement}
      data-mac-app-offer-layout={layout}
      data-leaving={leaving || undefined}
      data-settled={settled || undefined}
      onAnimationEnd={onAnimationEnd}
    >
      <span className={css.Mark({ layout })} aria-hidden>
        <Icon src={MacAppIcon} size="100" />
      </span>
      {layout === 'stacked' ? (
        <>
          <div className={css.Words}>
            <Text as="div" size="T300" className={css.Title}>
              {t('featureUi.macApp.title')}
            </Text>
            <Text as="div" size="T200" priority="300">
              {t('featureUi.macApp.text')}
            </Text>
          </div>
          <div className={css.Actions}>
            {download(t('featureUi.macApp.download'), 'download')}
            <Button
              size="300"
              radii="300"
              variant="Secondary"
              fill="None"
              data-mac-app-offer-action="later"
              onClick={answer}
            >
              <Text as="span" size="B300" truncate>
                {t('featureUi.macApp.notNow')}
              </Text>
            </Button>
          </div>
        </>
      ) : (
        <div className={css.Line}>
          <Text as="div" size="T300" className={css.Sentence}>
            <Trans i18nKey="featureUi.macApp.banner" components={{ b: <b /> }} />
          </Text>
          {download(t('featureUi.macApp.bannerDownload'), 'download')}
        </div>
      )}
      <IconButton
        className={css.Dismiss({ layout })}
        variant="Secondary"
        fill="None"
        size="300"
        radii="300"
        aria-label={t('featureUi.macApp.dismiss')}
        data-mac-app-offer-action="dismiss"
        onClick={answer}
      >
        <Icon src={Icons.Cross} size="100" />
      </IconButton>
    </Surface>,
    slot
  );
}
