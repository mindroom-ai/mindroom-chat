import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Chip, Icon, Icons, Spinner, Text, color } from 'folds';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  CryptoEvent,
  ImportRoomKeyStage,
  type BackupTrustInfo,
  type ImportRoomKeyProgressData,
  type KeyBackupInfo,
} from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../lib/hooks/useAlive';
import { SettingTile } from '../../ui/SettingTile';
import { fetchKeyBackupVersion } from '../encryption/keyBackupVersion';
import { useDefaultSecretStorageKey } from '../encryption/useDefaultSecretStorageKey';
import { describeKey } from '../encryption/recoveryState';
import { TurnOnBackupForm } from '../encryption/TurnOnBackupForm';
import { describeError } from '../../lib/describeError';
import { ErrorDetail } from '../../ui/ErrorDetail';

const KEY = 'sharedUi.backupRestore';

/** The latest server-side backup and how this session relates to it. */
type BackupState = {
  /** `null` when the server has no backup. */
  info: KeyBackupInfo | null;
  trust?: BackupTrustInfo;
  /** The version this session uploads new keys to; `null` while it uploads to none. */
  activeVersion: string | null;
};

/** The server could not say whether there is a backup, which is not the same as "none". */
const CHECK_FAILED = 'failed';

/** Asks the server itself, because the SDK's cached copy keeps the key count of its last check. */
const readBackupState = async (client: MatrixClient): Promise<BackupState> => {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error('No crypto module to read the key backup with');
  const [info, activeVersion] = await Promise.all([
    fetchKeyBackupVersion(client),
    crypto.getActiveSessionBackupVersion(),
  ]);
  const trust = info ? await crypto.isKeyBackupTrusted(info) : undefined;
  return { info, trust, activeVersion };
};

/** Backup events after which the state above may differ. */
const BACKUP_EVENTS = [
  CryptoEvent.KeyBackupStatus,
  CryptoEvent.KeyBackupDecryptionKeyCached,
  CryptoEvent.KeysChanged,
] as const;

/**
 * The backup state, read again on backup events and once uploads finish; `remaining` counts keys
 * still to upload. `undefined` while the first read runs, and `failed` when no read has worked yet
 * or a requested one failed; a failed read after a good one keeps the good answer. The events come
 * in bursts and their reads can answer out of order, so only the newest read's answer is shown.
 */
const useBackupState = () => {
  const client = useMatrixClient();
  const [state, setState] = useState<BackupState | typeof CHECK_FAILED>();
  const [remaining, setRemaining] = useState(0);
  // The newest read; an answer to an older one, or one that comes after unmounting, is dropped.
  const newest = useRef(0);

  /** `requested`: someone asked (Retry, a finished restore), so a failure shows as one. */
  const read = useCallback(
    (requested: boolean) => {
      newest.current += 1;
      const request = newest.current;
      readBackupState(client).then(
        (next) => {
          if (request === newest.current) setState(next);
        },
        () => {
          if (request !== newest.current) return;
          setState((current) => (requested ? CHECK_FAILED : current ?? CHECK_FAILED));
        }
      );
    },
    [client]
  );

  useEffect(() => {
    const onEvent = () => read(false);
    const uploading = (count: number) => {
      setRemaining(count);
      // The key count on the server changed once a round of uploads is through.
      if (count === 0) read(false);
    };
    read(false);
    BACKUP_EVENTS.forEach((event) => client.on(event, onEvent));
    client.on(CryptoEvent.KeyBackupSessionsRemaining, uploading);
    return () => {
      newest.current += 1;
      BACKUP_EVENTS.forEach((event) => client.off(event, onEvent));
      client.off(CryptoEvent.KeyBackupSessionsRemaining, uploading);
    };
  }, [client, read]);

  const refresh = useCallback(() => read(true), [read]);

  /** Asks again after a failed check, showing the spinner meanwhile. */
  const recheck = useCallback(() => {
    setState(undefined);
    read(true);
  }, [read]);

  return { state, remaining, refresh, recheck };
};

/** Restore progress in percent; `0` until the keys are downloaded and their count is known. */
export const progressPercent = (progress: ImportRoomKeyProgressData | undefined): number => {
  if (!progress || progress.stage !== ImportRoomKeyStage.LoadKeys || progress.total <= 0) return 0;
  return Math.floor(((progress.successes + progress.failures) / progress.total) * 100);
};

function TrustLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <Box alignItems="Center" gap="100">
      <Icon
        size="50"
        src={ok ? Icons.Check : Icons.Warning}
        style={{ color: ok ? color.Success.Main : color.Critical.Main }}
      />
      <Text size="T200" style={ok ? undefined : { color: color.Critical.Main }}>
        {children}
      </Text>
    </Box>
  );
}

/**
 * Server-side key backup (spec: "Server-side key backups"): whether this session uploads to it,
 * how many keys it holds, whether this session trusts it, and a full restore of its keys into
 * this session.
 */
export function KeyBackupTile() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const { state, remaining, refresh, recheck } = useBackupState();
  const [showDetails, setShowDetails] = useState(false);
  const [restoring, setRestoring] = useState<ImportRoomKeyProgressData | 'starting'>();
  const [error, setError] = useState<{ failure: unknown }>();
  const storageKey = useDefaultSecretStorageKey();
  const [turningOn, setTurningOn] = useState(false);

  if (state === undefined) {
    return (
      <SettingTile
        focusId="keyBackup"
        title={t(`${KEY}.encryptionBackup`)}
        after={<Spinner size="200" variant="Secondary" />}
      />
    );
  }

  if (state === CHECK_FAILED) {
    return (
      <SettingTile
        focusId="keyBackup"
        title={t(`${KEY}.encryptionBackup`)}
        description={
          <span role="alert" style={{ color: color.Warning.Main }}>
            {t(`${KEY}.checkFailed`)}
          </span>
        }
        after={
          <Button size="300" radii="300" variant="Secondary" fill="Soft" onClick={recheck}>
            <Text size="B300">{t('sharedUi.clientRoot.retry')}</Text>
          </Button>
        }
      />
    );
  }

  const { info } = state;
  if (!info) {
    // With secret storage, a backup can be turned on without a reset: its key goes there.
    const canTurnOn = !!storageKey;
    return (
      <SettingTile
        focusId="keyBackup"
        title={t(`${KEY}.encryptionBackup`)}
        description={
          <span style={{ color: color.Critical.Main }}>{t(`${KEY}.noBackupPresentOnServer`)}</span>
        }
        after={
          canTurnOn && !turningOn ? (
            <Button
              size="300"
              radii="300"
              variant="Primary"
              fill="Solid"
              onClick={() => setTurningOn(true)}
            >
              <Text size="B300">{t('sharedUi.recoveryPassword.turnOnBackup')}</Text>
            </Button>
          ) : undefined
        }
      >
        {storageKey && turningOn && (
          <TurnOnBackupForm
            secretStorageKey={describeKey(storageKey)}
            onDone={() => {
              setTurningOn(false);
              refresh();
            }}
          />
        )}
      </SettingTile>
    );
  }

  const connection =
    remaining > 0
      ? t(`${KEY}.syncing`, { count: remaining })
      : t(state.activeVersion ? `${KEY}.connected` : `${KEY}.disconnected`);
  const summary = [
    connection,
    t(`${KEY}.version`, { version: info.version ?? t(`${KEY}.nil`) }),
    t(`${KEY}.keys`, { keyCount: info.count ?? t(`${KEY}.nil`) }),
  ].join(' · ');

  const restore = async () => {
    const crypto = client.getCrypto();
    if (!crypto || restoring) return;
    setRestoring('starting');
    setError(undefined);
    try {
      await crypto.restoreKeyBackup({
        progressCallback: (progress) => alive() && setRestoring(progress),
      });
    } catch (failure) {
      if (alive()) setError({ failure });
    } finally {
      if (alive()) {
        setRestoring(undefined);
        refresh();
      }
    }
  };

  const percent = restoring && restoring !== 'starting' ? progressPercent(restoring) : 0;
  const restoreLabel = restoring
    ? t(`${KEY}.restoring`, { progress: percent })
    : t(`${KEY}.restoreBackup`);

  return (
    <SettingTile
      focusId="keyBackup"
      title={t(`${KEY}.encryptionBackup`)}
      description={
        <span style={{ color: state.activeVersion ? undefined : color.Warning.Main }}>
          {summary}
        </span>
      }
      after={
        <Button
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          // Only a session holding the backup's decryption key can read it: one that created the
          // backup, received the key from a verified session, or unlocked secret storage.
          disabled={!!restoring || !state.trust?.matchesDecryptionKey}
          before={restoring ? <Spinner size="50" variant="Secondary" /> : undefined}
          onClick={() => void restore()}
        >
          <Text size="B300">{restoreLabel}</Text>
        </Button>
      }
    >
      <Box direction="Column" gap="200" alignItems="Start">
        <Chip
          variant="Secondary"
          radii="Pill"
          size="400"
          aria-expanded={showDetails}
          after={<Icon size="50" src={showDetails ? Icons.ChevronTop : Icons.ChevronBottom} />}
          onClick={() => setShowDetails((open) => !open)}
        >
          <Text size="B300">{t(`${KEY}.backupDetails`)}</Text>
        </Chip>
        {showDetails && state.trust && (
          <Box direction="Column" gap="100">
            <TrustLine ok={state.trust.matchesDecryptionKey}>
              {state.trust.matchesDecryptionKey
                ? t(`${KEY}.backupHasTrustedDecryptionKey`)
                : t(`${KEY}.backupDoesNotHaveTrustedDecryptionKey`)}
            </TrustLine>
            <TrustLine ok={state.trust.trusted}>
              {state.trust.trusted
                ? t(`${KEY}.backupHasTrustedBySignature`)
                : t(`${KEY}.backupDoesNotHaveTrustedSignature`)}
            </TrustLine>
          </Box>
        )}
        {error && (
          <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
            {describeError(t, error.failure)}
            <ErrorDetail error={error.failure} />
          </Text>
        )}
      </Box>
    </SettingTile>
  );
}
