import { type ReactNode, createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Text, config } from 'folds';
import { reloadForNewVersion } from '../config/appUpdate';
import type { PartLoadRetry } from '../lib/lazyPart';
import { retryPart } from './partRetry';

/**
 * Whether a reload of the page would lose something, such as a call or a file not yet sent. The
 * account's providers supply it; without them a reload is assumed to lose something, so the view
 * asks first.
 */
export const ReloadWouldLoseWorkContext = createContext<() => boolean>(() => true);

/**
 * `reloading` follows a Retry that reloads on its own, `reloadingAsked` the Reload of a view that
 * said a reload was needed; each keeps the message it had.
 */
type ViewState = 'failed' | 'retrying' | 'reloading' | 'reloadNeeded' | 'reloadingAsked';

/**
 * The view of a part of the app that could not load (src/app/lib/lazyPart.tsx): a short message
 * and Retry. Retry loads the part again and, when the browser will not load it again in this page,
 * reloads the page if nothing would be lost (./partRetry.ts); otherwise it says that a
 * reload is needed and offers one. `children` go after the button, such as a way to close a panel
 * that has no other.
 */
export function PartUnavailable({ retryLoad, children }: PartLoadRetry & { children?: ReactNode }) {
  const { t } = useTranslation();
  const wouldLoseWork = useContext(ReloadWouldLoseWorkContext);
  const [state, setState] = useState<ViewState>('failed');

  const reload = (asked: boolean) => {
    setState(asked ? 'reloadingAsked' : 'reloading');
    reloadForNewVersion().catch(() => setState('reloadNeeded'));
  };

  const retry = () => {
    setState('retrying');
    retryPart({
      retryLoad,
      online: () => navigator.onLine,
      wouldLoseWork,
      reload: () => reload(false),
    })
      .then((outcome) => {
        // A loaded part replaces this view; a reload keeps its own state.
        if (outcome === 'offline') setState('failed');
        if (outcome === 'reloadNeeded') setState('reloadNeeded');
      })
      .catch(() => setState('failed'));
  };

  const needsReload = state === 'reloadNeeded' || state === 'reloadingAsked';
  return (
    <Box
      grow="Yes"
      direction="Column"
      alignItems="Center"
      justifyContent="Center"
      gap="300"
      style={{ padding: config.space.S400, textAlign: 'center' }}
      data-part-unavailable
    >
      <Text size="T300" priority="300" aria-live="polite">
        {needsReload
          ? t('sharedUi.partUnavailable.reloadNeeded')
          : t('sharedUi.partUnavailable.failed')}
      </Text>
      <Button
        type="button"
        size="300"
        radii="300"
        variant="Secondary"
        fill="Soft"
        disabled={state !== 'failed' && state !== 'reloadNeeded'}
        onClick={needsReload ? () => reload(true) : retry}
      >
        <Text size="B300">
          {needsReload ? t('sharedUi.partUnavailable.reload') : t('sharedUi.partUnavailable.retry')}
        </Text>
      </Button>
      {children}
    </Box>
  );
}
