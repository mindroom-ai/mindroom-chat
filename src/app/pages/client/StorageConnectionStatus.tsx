import React, { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, config, Line, Text } from 'folds';
import { ContainerColor } from '../../styles/ContainerColor.css';
import {
  getStorageConnectionState,
  reloadAfterStorageLoss,
  subscribeStorageConnectionState,
} from '../../mindroom/client/storageConnectionRecovery';

/** Keeps a degraded storage connection visible until the page reloads. */
export function StorageConnectionStatus() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(
    subscribeStorageConnectionState,
    getStorageConnectionState,
    getStorageConnectionState
  );

  if (state === 'healthy') return null;

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
          {t(
            state === 'manual' ? 'sharedUi.storageStatus.lostAgain' : 'sharedUi.storageStatus.lost'
          )}
        </Text>
        <Button
          size="300"
          variant="Warning"
          fill="Solid"
          radii="300"
          onClick={() => reloadAfterStorageLoss({ automatic: false })}
        >
          <Text as="span" size="B300">
            {t('sharedUi.storageStatus.reload')}
          </Text>
        </Button>
      </Box>
      <Line variant="Warning" size="300" />
    </Box>
  );
}
