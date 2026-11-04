import { useMemo, useState, useSyncExternalStore } from 'react';
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

const OFFLINE_KEY = 'featureUi.roomSettings.general.offline';

/** Message keys for the engine statuses that pause or block saving. */
const PAUSE_MESSAGE_KEYS = {
  error: `${OFFLINE_KEY}.errorPause`,
  hidden: `${OFFLINE_KEY}.backgroundPause`,
  limited: `${OFFLINE_KEY}.connectionPause`,
  offline: `${OFFLINE_KEY}.offlinePause`,
  'read-only': `${OFFLINE_KEY}.readOnlyPause`,
  space: `${OFFLINE_KEY}.spacePause`,
  unavailable: `${OFFLINE_KEY}.unavailable`,
} as const;

const useOfflineRoomSnapshot = (roomId: string): OfflineRoomSnapshot => {
  const { offline } = useMindroomSyncEngine();
  const store = useMemo(
    () => ({
      listen: (onStoreChange: () => void) => offline.subscribe(roomId, onStoreChange),
      read: () => offline.getSnapshot(roomId),
    }),
    [offline, roomId]
  );
  return useSyncExternalStore(store.listen, store.read);
};

type ClearContentDialogProps = {
  onCancel: () => void;
  onConfirm: () => void;
  clearing: boolean;
  failed: boolean;
};

const DIALOG_HEADER_STYLE = {
  paddingBlock: 0,
  paddingInlineStart: config.space.S400,
  paddingInlineEnd: config.space.S200,
};

function ClearContentDialog({ onCancel, onConfirm, clearing, failed }: ClearContentDialogProps) {
  const { t } = useTranslation();
  const cancelLabel = t(`${OFFLINE_KEY}.cancel`);
  const trapOptions = {
    initialFocus: false as const,
    clickOutsideDeactivates: true,
    onDeactivate: onCancel,
  };

  const header = (
    <Header variant="Surface" size="500" style={DIALOG_HEADER_STYLE}>
      <Box grow="Yes">
        <Text size="H4">{t(`${OFFLINE_KEY}.clearTitle`)}</Text>
      </Box>
      <IconButton aria-label={cancelLabel} size="300" radii="300" onClick={onCancel}>
        <Icon src={Icons.Cross} />
      </IconButton>
    </Header>
  );

  const actions = (
    <Box direction="Column" gap="200">
      <Button
        variant="Critical"
        disabled={clearing}
        before={clearing ? <Spinner variant="Critical" fill="Solid" size="100" /> : undefined}
        onClick={onConfirm}
      >
        <Text size="B400">{t(`${OFFLINE_KEY}.clearConfirm`)}</Text>
      </Button>
      <Button variant="Secondary" fill="Soft" disabled={clearing} onClick={onCancel}>
        <Text size="B400">{cancelLabel}</Text>
      </Button>
    </Box>
  );

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={trapOptions}>
          <Dialog variant="Surface">
            {header}
            <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
              <Text priority="400">{t(`${OFFLINE_KEY}.clearDescription`)}</Text>
              {failed ? (
                <Text style={{ color: color.Critical.Main }}>
                  {t(`${OFFLINE_KEY}.clearFailed`)}
                </Text>
              ) : null}
              {actions}
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

/** Where clearing the downloaded content stands; the dialog shows unless `closed`. */
type ClearPhase = 'closed' | 'confirming' | 'clearing' | 'failed';

/**
 * Offline copy of one room: what is saved and what is not, downloading the
 * whole room, keeping it offline, and clearing what was downloaded.
 */
export function OfflineRoomSettings({ roomId }: OfflineRoomSettingsProps) {
  const { offline } = useMindroomSyncEngine();
  const { t } = useTranslation();
  const snapshot = useOfflineRoomSnapshot(roomId);
  const [clearPhase, setClearPhase] = useState<ClearPhase>('closed');
  const [pinFailed, setPinFailed] = useState(false);
  const [includeAllMedia, setIncludeAllMedia] = useState(false);

  const handlePinned = (pinned: boolean) => {
    setPinFailed(false);
    return offline.setPinned(roomId, pinned).catch(() => setPinFailed(true));
  };

  const handleClear = async () => {
    setClearPhase('clearing');
    try {
      await offline.clear(roomId);
    } catch {
      setClearPhase('failed');
      return;
    }
    setClearPhase('closed');
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
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            before={<Spinner size="100" variant="Secondary" fill="Soft" />}
            onClick={() => offline.cancel(roomId)}
          >
            <Text size="B300">{t('featureUi.roomSettings.general.offline.cancelDownload')}</Text>
          </Button>
        ) : (
          <Button
            size="300"
            radii="300"
            variant="Primary"
            fill="Soft"
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
          onClick={() => setClearPhase('confirming')}
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
          onChange={(pinned) => void handlePinned(pinned)}
        />
      </Box>
      {pinFailed && (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {t('featureUi.roomSettings.general.offline.pinFailed')}
        </Text>
      )}
      {clearPhase === 'closed' ? null : (
        <ClearContentDialog
          clearing={clearPhase === 'clearing'}
          failed={clearPhase === 'failed'}
          onCancel={() => setClearPhase('closed')}
          onConfirm={() => void handleClear()}
        />
      )}
    </Box>
  );
}
