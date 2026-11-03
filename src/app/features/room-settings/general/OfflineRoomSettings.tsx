import React, { useCallback, useState, useSyncExternalStore } from 'react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Switch,
  Text,
  color,
  config,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import { Dialog, Header } from '../../../components/glass/GlassPrimitives';
import { useMindroomSyncEngine } from '../../../mindroom/engine/engineContext';
import type { OfflineRoomSnapshot } from '../../../mindroom/engine/roomOffline';

type OfflineRoomSettingsProps = {
  roomId: string;
};

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

const formatBytes = (bytes: number): string => {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${SIZE_UNITS[unit]}`;
};

const PAUSE_MESSAGE_KEYS = {
  space: 'featureUi.roomSettings.general.offline.spacePause',
  'read-only': 'featureUi.roomSettings.general.offline.readOnlyPause',
  offline: 'featureUi.roomSettings.general.offline.offlinePause',
  hidden: 'featureUi.roomSettings.general.offline.backgroundPause',
  limited: 'featureUi.roomSettings.general.offline.connectionPause',
  error: 'featureUi.roomSettings.general.offline.errorPause',
  unavailable: 'featureUi.roomSettings.general.offline.unavailable',
} as const;

const useOfflineRoomSnapshot = (roomId: string): OfflineRoomSnapshot => {
  const { offline } = useMindroomSyncEngine();
  const subscribe = useCallback(
    (listener: () => void) => offline.subscribe(roomId, listener),
    [offline, roomId]
  );
  const getSnapshot = useCallback(() => offline.getSnapshot(roomId), [offline, roomId]);
  return useSyncExternalStore(subscribe, getSnapshot);
};

function ClearContentDialog({
  onCancel,
  onConfirm,
  clearing,
  failed,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  clearing: boolean;
  failed: boolean;
}) {














              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text size="H4">{t('featureUi.roomSettings.general.offline.clearTitle')}</Text>
              </Box>
              <IconButton
                size="300"
                onClick={onCancel}
                radii="300"








              </Text>
              {failed && (
                <Text style={{ color: color.Critical.Main }}>
                  {t('featureUi.roomSettings.general.offline.clearFailed')}
                </Text>
              )}
              <Box direction="Column" gap="200">
                <Button
                  variant="Critical"
                  onClick={onConfirm}
                  disabled={clearing}
                  before={
                    clearing ? <Spinner size="100" variant="Critical" fill="Solid" /> : undefined
                  }
                >
                  <Text size="B400">
                    {t('featureUi.roomSettings.general.offline.clearConfirm')}
                  </Text>
                </Button>
                <Button variant="Secondary" fill="Soft" onClick={onCancel} disabled={clearing}>
                  <Text size="B400">{t('featureUi.roomSettings.general.offline.cancel')}</Text>
                </Button>
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

/**
 * Offline copy of one room: what is saved and what is not, downloading the
 * whole room, keeping it offline, and clearing what was downloaded.
 */
export function OfflineRoomSettings({ roomId }: OfflineRoomSettingsProps) {
  const { t } = useTranslation();
  const { offline } = useMindroomSyncEngine();
  const snapshot = useOfflineRoomSnapshot(roomId);
  const [includeAllMedia, setIncludeAllMedia] = useState(false);
  const [pinFailed, setPinFailed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);

  const handlePinned = async (pinned: boolean) => {
    setPinFailed(false);
    try {
      await offline.setPinned(roomId, pinned);
    } catch {
      setPinFailed(true);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    setClearFailed(false);
    try {
      await offline.clear(roomId);
      setConfirmClear(false);
    } catch {
      setClearFailed(true);
    } finally {
      setClearing(false);
    }
  };

  const pauseKey = PAUSE_MESSAGE_KEYS[snapshot.status as keyof typeof PAUSE_MESSAGE_KEYS];
  let progressKey:
    | 'featureUi.roomSettings.general.offline.checking'
    | 'featureUi.roomSettings.general.offline.downloading'
    | 'featureUi.roomSettings.general.offline.notSaved'
    | undefined;
  if (!snapshot.loaded) progressKey = 'featureUi.roomSettings.general.offline.checking';
  else if (snapshot.downloading && !pauseKey)
    progressKey = 'featureUi.roomSettings.general.offline.downloading';
  else if (snapshot.savedEvents === 0)
    progressKey = 'featureUi.roomSettings.general.offline.notSaved';
  const details: string[] = [];
  if (!snapshot.historyComplete)
    details.push(t('featureUi.roomSettings.general.offline.partialHistory'));
  if (snapshot.hasGap)
    details.push(t('featureUi.roomSettings.general.offline.inaccessibleHistory'));
  if (snapshot.undecryptedEvents > 0) {
    details.push(
      t('featureUi.roomSettings.general.offline.waitingForKeys', {
        count: snapshot.undecryptedEvents,
      })
    );
  }
  if (snapshot.unresolvedRelations > 0) {
    details.push(
      t('featureUi.roomSettings.general.offline.unresolvedRelations', {
        count: snapshot.unresolvedRelations,
      })
    );
  }
  if (snapshot.missingEssential > 0) {
    details.push(
      t('featureUi.roomSettings.general.offline.missingEssential', {
        count: snapshot.missingEssential,
      })
    );
  }
  if (snapshot.saved > 0 || snapshot.missing > 0) {
    details.push(
      t('featureUi.roomSettings.general.offline.attachments', {
        saved: snapshot.saved,
        missing: snapshot.missing,
      })
    );
  }

  return (
    <Box direction="Column" gap="300">
      <Box direction="Column" gap="100">
        <Text size="L400">{t('featureUi.roomSettings.general.offline.title')}</Text>
        {progressKey && <Text size="T200">{t(progressKey)}</Text>}
      </Box>
      {pauseKey && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {t(pauseKey)}
        </Text>
      )}
      <Box direction="Column" gap="100">
        <Text size="T200">
          {t('featureUi.roomSettings.general.offline.historyEntries', {
            count: snapshot.savedEvents,
          })}
        </Text>
        <Text size="T200">
          {t('featureUi.roomSettings.general.offline.storageUsed', {
            size: formatBytes(snapshot.bytes),
          })}
        </Text>
        {details.map((detail) => (
          <Text key={detail} size="T200">
            {detail}
          </Text>
        ))}
      </Box>
      <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
        <Text size="T300">{t('featureUi.roomSettings.general.offline.includeAllMedia')}</Text>
        <Switch
          aria-label={t('featureUi.roomSettings.general.offline.includeAllMedia')}
          value={includeAllMedia}
          onChange={setIncludeAllMedia}
          disabled={snapshot.downloading}
        />
      </Box>
      <Box gap="200" wrap="Wrap">
        {snapshot.downloading ? (
          <Button
            variant="Secondary"
            fill="Soft"
            size="300"
            radii="300"
            onClick={() => offline.cancel(roomId)}
          >
            <Text size="B300">{t('featureUi.roomSettings.general.offline.cancelDownload')}</Text>
          </Button>
        ) : (
          <Button
            variant="Primary"
            fill="Soft"
            size="300"
            radii="300"
            onClick={() => offline.download(roomId, { includeAllMedia })}
          >
            <Text size="B300">
              {t('featureUi.roomSettings.general.offline.downloadEntireRoom')}
            </Text>
          </Button>
        )}
        <Button
          variant="Critical"
          fill="None"
          size="300"
          radii="300"
          onClick={() => {
            setClearFailed(false);
            setConfirmClear(true);
          }}
        >
          <Text size="B300">
            {t('featureUi.roomSettings.general.offline.clearDownloadedContent')}
          </Text>
        </Button>
      </Box>
      <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
        <Box direction="Column">
          <Text size="T300">{t('featureUi.roomSettings.general.offline.keepOffline')}</Text>
          <Text size="T200">
            {t('featureUi.roomSettings.general.offline.keepOfflineDescription')}
          </Text>
        </Box>
        <Switch
          aria-label={t('featureUi.roomSettings.general.offline.keepOffline')}
          value={snapshot.pinned}
          onChange={handlePinned}
        />
      </Box>
      {pinFailed && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {t('featureUi.roomSettings.general.offline.pinFailed')}
        </Text>
      )}
      {confirmClear && (
        <ClearContentDialog
          clearing={clearing}
          failed={clearFailed}
          onCancel={() => setConfirmClear(false)}
          onConfirm={handleClear}
        />
      )}
    </Box>
  );
}
