import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, config, Line, Text } from 'folds';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { persistKnownSessionStore } from '../../state/sessions';
import {
  getStorageConnectionState,
  hasStorageRecoveryBlocker,
  registerStorageRecoveryHost,
  registerStorageRecoveryPreparation,
  reloadAfterStorageLoss,
  subscribeStorageConnectionState,
} from '../../mindroom/client/storageConnectionRecovery';

const BLOCKER_CHECK_INTERVAL_MS = 1_000;
const CONFIRM_TIMEOUT_MS = 10_000;

/**
 * Keeps a degraded storage connection visible until the page reloads. Its
 * client session hosts automatic recovery, including while the client loads
 * or shows a startup error.
 */
export function StorageConnectionStatus() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(
    subscribeStorageConnectionState,
    getStorageConnectionState,
    getStorageConnectionState
  );
  const [blocked, setBlocked] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const unregisterHost = registerStorageRecoveryHost();
    // The session registry needs saving even when no client has started yet.
    const unregisterPreparation = registerStorageRecoveryPreparation(() =>
      persistKnownSessionStore()
    );
    return () => {
      unregisterHost();
      unregisterPreparation();
    };
  }, []);

  useEffect(() => {
    if (state === 'healthy') return undefined;
    const check = () => setBlocked(hasStorageRecoveryBlocker());
    check();
    const interval = window.setInterval(check, BLOCKER_CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [state]);

  useEffect(() => {
    if (!confirming) return undefined;
    if (!blocked) {
      setConfirming(false);
      return undefined;
    }
    const timeout = window.setTimeout(() => setConfirming(false), CONFIRM_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [blocked, confirming]);

  if (state === 'healthy') return null;

  const message = confirming
    ? 'sharedUi.storageStatus.confirmDiscard'
    : state === 'manual'
    ? 'sharedUi.storageStatus.lostAgain'
    : blocked
    ? 'sharedUi.storageStatus.blocked'
    : 'sharedUi.storageStatus.lost';
  const reload = () => {
    // Saved composer text survives; recordings, attachments, and open edits do not,
    // so a reload over them takes a second tap after the warning.
    if (!confirming && hasStorageRecoveryBlocker()) {
      setBlocked(true);
      setConfirming(true);
      return;
    }
    reloadAfterStorageLoss({ automatic: false });
  };

  return (
    <Box data-testid="client-storage-status" direction="Column" shrink="No">
      <Box
        className={ContainerColor({ variant: 'Warning' })}
        style={{ padding: `${config.space.S100} ${config.space.S300}` }}
        alignItems="Center"
        justifyContent="Center"
        gap="300"
      >
        <Text size="L400" role="status">
          {t(message)}
        </Text>
        <Button size="300" variant="Warning" fill="Solid" radii="300" onClick={reload}>
          <Text as="span" size="B300">
            {t('sharedUi.storageStatus.reload')}
          </Text>
        </Button>
      </Box>
      <Line variant="Warning" size="300" />
    </Box>
  );
}
