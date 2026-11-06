import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconButton, Icons, Text } from 'folds';
import { getNewVersion, reloadForNewVersion, subscribeToNewVersion } from '../config/appUpdate';
import * as noticeCss from '../notifications/notices/NoticeBanners.css';

/** The new version the server publishes, if the page found one (src/app/config/appUpdate.ts). */
export const useNewVersion = (): string | undefined =>
  useSyncExternalStore(subscribeToNewVersion, getNewVersion);

/**
 * "A new version is available" with a Reload action, above every screen in the look of the
 * operator notices. It appears once the server publishes another build than this page's, found
 * when a part fails to load, when the page is shown again, or by a check every five minutes
 * (src/app/config/appUpdate.ts); dismissed, it stays away for the life of the page.
 */
export function NewVersionNotice() {
  const { t } = useTranslation();
  const version = useNewVersion();
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const shown = version !== undefined && !dismissed;

  const reload = () => {
    setReloading(true);
    reloadForNewVersion().catch(() => setReloading(false));
  };

  // The live region stays in the page, so the notice is announced when it appears. It has no
  // status role: the operator notices' stack is the page's status region.
  return (
    <div aria-live="polite" className={noticeCss.NoticeStack} data-new-version-notice>
      {shown && (
        <div className={noticeCss.Notice({ level: 'info' })} data-notice-level="info">
          <span className={noticeCss.NoticeIcon} aria-hidden>
            <Icon src={Icons.Info} size="100" filled />
          </span>
          <div className={noticeCss.NoticeBody}>
            <Text as="div" size="T300" className={noticeCss.NoticeText}>
              {t('sharedUi.appUpdate.available')}
            </Text>
            <Text
              as="button"
              size="T300"
              type="button"
              className={noticeCss.NoticeAction}
              disabled={reloading}
              onClick={reload}
            >
              {t('sharedUi.appUpdate.reload')}
            </Text>
          </div>
          <IconButton
            variant="Primary"
            fill="None"
            size="300"
            radii="300"
            aria-label={t('sharedUi.appUpdate.dismiss')}
            onClick={() => setDismissed(true)}
          >
            <Icon src={Icons.Cross} size="100" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
