import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { Button, Icon, IconButton, Icons, Text } from 'folds';
import { useClientConfig } from '../config/useClientConfig';
import { useAccountData } from '../matrix/hooks/useAccountData';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { createSessionId } from '../matrix/session/sessions';
import { PHONE_SLIDE_OUT_MS, phoneLayerOpenAtom } from '../navigation/phoneNavDrawer';
import { tourAtom, tourOfferAnsweredAtom } from '../navigation/tourState';
import {
  MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE,
  sanitizeAccountSettings,
} from '../preferences/accountSettings';
import { Surface } from '../ui/glass/GlassPrimitives';
import { listNoticeSlotAtom, pageNoticeSlotAtom, useNoticePresence } from '../ui/noticeSlots';
import type { ContextualTip } from './contextualTips';
import * as css from './TourOffer.css';
import { useContextualTip } from './useContextualTip';

function ContextualTipNoticeForSession({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const offerAtStart = useClientConfig().tour?.offerAtStart !== false;
  const settings = sanitizeAccountSettings(
    useAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE)?.getContent()
  );
  const tourOpen = useAtomValue(tourAtom) !== undefined;
  const tourAnsweredHere = useAtomValue(tourOfferAnsweredAtom).has(sessionId);
  const tourAnswered = settings.tourOffered || tourAnsweredHere;
  const tourFirst = (offerAtStart && !tourAnswered) || tourOpen;

  const { tip, dismissTip, openTipTour } = useContextualTip();
  const [presentedTip, setPresentedTip] = useState<ContextualTip>();
  if (
    tip &&
    (presentedTip?.id !== tip.id ||
      presentedTip.scope !== tip.scope ||
      presentedTip.openCount !== tip.openCount)
  ) {
    setPresentedTip(tip);
  }

  const listSlot = useAtomValue(listNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const hasPlace = listSlot !== null || pageSlot !== null;
  const phoneLayerOpen = useAtomValue(phoneLayerOpenAtom);
  const { shown, slot, placement, leaving, settled, dismiss, onAnimationEnd } = useNoticePresence(
    offerAtStart && !tourFirst && hasPlace && tip !== undefined,
    { open: phoneLayerOpen, slideOutMs: PHONE_SLIDE_OUT_MS }
  );

  const activeTip = tip ?? presentedTip;
  if (!shown || !slot || !activeTip) return null;

  const layout = placement === 'list' || slot.hasAttribute('data-phone') ? 'stacked' : 'row';
  return createPortal(
    <Surface
      className={css.Card({ placement, layout })}
      data-contextual-tip={activeTip.id}
      data-contextual-tip-placement={placement}
      data-leaving={leaving || undefined}
      data-settled={settled || undefined}
      onAnimationEnd={onAnimationEnd}
    >
      <span className={css.Mark({ layout })} aria-hidden="true">
        <Icon src={Icons.Check} size="100" />
      </span>
      <div className={css.Body({ layout })}>
        <div className={css.Words({ layout })}>
          <Text as="div" size="T300" className={css.Title}>
            {t('tour.tips.resolve.cardTitle')}
          </Text>
          <Text as="div" size="T200" priority="300">
            {t(
              activeTip.scope === 'room'
                ? 'tour.tips.resolve.cardTextRoom'
                : 'tour.tips.resolve.cardTextAll',
              { count: activeTip.openCount }
            )}
          </Text>
        </div>
        <div className={css.Actions({ layout })}>
          <Button
            className={css.Action({ layout })}
            size="300"
            radii="300"
            variant="Primary"
            fill="Solid"
            data-contextual-tip-action="show-how"
            onClick={() => {
              dismiss();
              openTipTour(activeTip);
            }}
          >
            <Text as="span" size="B300" truncate>
              {t('tour.help.showHow')}
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
        aria-label={t('tour.help.dismissTip')}
        data-contextual-tip-action="dismiss"
        onClick={() => {
          dismiss();
          dismissTip(activeTip.id);
        }}
      >
        <Icon src={Icons.Cross} size="100" />
      </IconButton>
    </Surface>,
    slot
  );
}

/**
 * One-time floating tip card shown in the shared NoticeSlot after the initial tour offer is
 * answered when unresolved threads accumulate without any having been resolved yet.
 */
export function ContextualTipNotice() {
  const mx = useMatrixClient();
  const sessionId = createSessionId(mx.getHomeserverUrl(), mx.getSafeUserId());
  return <ContextualTipNoticeForSession key={sessionId} sessionId={sessionId} />;
}
