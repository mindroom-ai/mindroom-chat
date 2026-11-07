import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, IconButton, Icons, Text } from 'folds';
import { getNewVersion, reloadForNewVersion, subscribeToNewVersion } from '../config/appUpdate';
import { Surface } from '../ui/glass/GlassPrimitives';
import * as css from './NewVersionNotice.css';

/** The new version the server publishes, if the page found one (src/app/config/appUpdate.ts). */
export const useNewVersion = (): string | undefined =>
  useSyncExternalStore(subscribeToNewVersion, getNewVersion);

/**
 * "A new version is available" with a Reload action, on a card that floats over every screen: at
 * the foot of the room list on a desktop, below the top bar on a phone. It appears once the server
 * publishes another build than this page's, found when the page starts, when a part fails to load,
 * when the page is shown again, or by a check every five minutes (src/app/config/appUpdate.ts);
 * dismissed, it stays away for the life of the page.
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
  // status role: the operator notices' stack is the page's status region. Its card is fixed, so
  // the region takes no room and the page below never moves.
  return (
    <div aria-live="polite" data-new-version-notice>
      {shown && (
        <Surface className={css.Card} data-new-version-card>
          <span className={css.Mark} aria-hidden>
            <Icon src={Icons.Download} size="100" />
          </span>
          <div className={css.Body}>
            <Text as="div" size="T300" className={css.Text}>
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
      )}
    </div>
  );
}
