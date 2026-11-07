import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { Button, Icon, IconButton, Icons, Text } from 'folds';
import { getNewVersion, reloadForNewVersion, subscribeToNewVersion } from '../config/appUpdate';
import { phoneLayerOpenAtom } from '../navigation/phoneNavDrawer';
import { pageNavNoticeSlotAtom } from '../sidebar/pageNavNoticeSlot';
import { Surface } from '../ui/glass/GlassPrimitives';
import * as css from './NewVersionNotice.css';

/** The new version the server publishes, if the page found one (src/app/config/appUpdate.ts). */
export const useNewVersion = (): string | undefined =>
  useSyncExternalStore(subscribeToNewVersion, getNewVersion);

/**
 * "A new version is available" with a Reload action, on a card that floats over every screen
 * without moving it: at the foot of the room list beside the page, else over the page itself (see
 * NewVersionNotice.css.ts). It appears once the server publishes another build than this page's,
 * found when the page starts, when a part fails to load, when the page is shown again, or by a
 * check every five minutes (src/app/config/appUpdate.ts); dismissed, it stays away for the life of
 * the page. It renders at the top of the app's content box (NoticeLayout), which places it.
 */
export function NewVersionNotice() {
  const { t } = useTranslation();
  const version = useNewVersion();
  const listSlot = useAtomValue(pageNavNoticeSlotAtom);
  const phoneLayerOpen = useAtomValue(phoneLayerOpenAtom);
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const shown = version !== undefined && !dismissed;
  const placement = listSlot ? 'list' : 'page';

  const reload = () => {
    setReloading(true);
    reloadForNewVersion().catch(() => setReloading(false));
  };

  const card = shown && (
    <Surface className={css.Card({ placement })} data-new-version-card={placement}>
      <span className={css.Mark} aria-hidden>
        <Icon src={Icons.Download} size="100" />
      </span>
      <div className={css.Body}>
        <Text as="div" size="T300" className={css.Text({ placement })}>
          {t('sharedUi.appUpdate.available')}
        </Text>
        <Button
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
        variant="Secondary"
        fill="None"
        size="300"
        radii="300"
        aria-label={t('sharedUi.appUpdate.dismiss')}
        onClick={() => setDismissed(true)}
      >
        <Icon src={Icons.Cross} size="100" />
      </IconButton>
    </Surface>
  );

  // The live region stays in the page, so the notice is announced when it appears; the list's
  // place is a live region too (ResizablePageNav). It has no status role: the operator notices'
  // stack is the page's status region.
  return (
    <div
      aria-live="polite"
      className={css.Region}
      data-new-version-notice
      data-phone-layer-open={phoneLayerOpen || undefined}
    >
      {listSlot ? card && createPortal(card, listSlot) : card}
    </div>
  );
}
