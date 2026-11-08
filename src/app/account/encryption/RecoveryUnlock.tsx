import { FormEventHandler, ReactNode, useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Spinner, Text, color } from 'folds';
import type { ImportRoomKeyProgressData } from 'matrix-js-sdk/lib/crypto-api';
import { PasswordInput } from '../../ui/PasswordInput';
import { ErrorDetail } from '../../ui/ErrorDetail';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../lib/hooks/useAlive';
import { AsyncStatus, useAsyncCallback } from '../../lib/hooks/useAsyncCallback';
import { progressPercent } from '../devices/KeyBackupTile';
import { keyFromRecoveryInput } from './recoveryInput';
import type { DefaultSecretStorageKey } from './recoveryState';
import { unlockWithRecoveryKey } from './unlockWithRecoveryKey';
import { useRecoveryFailureText } from './useRecoveryFailureText';

const KEY = 'sharedUi.recoveryPassword';

/** Where the restore of the backed up room keys stands once the device is unlocked. */
type Restore =
  | { phase: 'running'; progress?: ImportRoomKeyProgressData }
  | { phase: 'done' | 'failed' };

type StatusProps = { tone: 'Success' | 'Critical'; children: ReactNode; detailOf?: unknown };

function Status({ tone, children, detailOf }: StatusProps) {
  return (
    <Text
      size="T200"
      role={tone === 'Critical' ? 'alert' : 'status'}
      style={{ color: color[tone].Main }}
    >
      <b>{children}</b>
      <ErrorDetail error={detailOf} />
    </Text>
  );
}

type RecoveryUnlockProps = {
  secretStorageKey: DefaultSecretStorageKey;
  /** Offered to an account that has a recovery key but no recovery password. */
  onSetPassword?: () => void;
  /** Called when an unlock attempt starts, so a parent keeps this form on screen until it ends. */
  onUnlockStarted?: () => void;
  /** Called once the device is unlocked, before the restore starts (not after unmounting). */
  onUnlocked?: () => void;
};

/**
 * One field for the recovery password or the recovery key. Unlocking verifies this device and
 * then restores the backed up room keys; a restore that fails leaves the device unlocked.
 */
export function RecoveryUnlock({
  secretStorageKey,
  onSetPassword,
  onUnlockStarted,
  onUnlocked,
}: RecoveryUnlockProps) {
  const { keyId, keyContent, hasPassphrase } = secretStorageKey;
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const inputId = useId();
  const [restore, setRestore] = useState<Restore>();
  const describeFailure = useRecoveryFailureText();

  const restoreMessages = useCallback(async () => {
    const crypto = client.getCrypto();
    // An account without a usable backup has nothing to restore, which is not a failure.
    if (!crypto || !(await crypto.getActiveSessionBackupVersion())) return;
    if (alive()) setRestore({ phase: 'running' });
    try {
      await crypto.restoreKeyBackup({
        progressCallback: (progress) => alive() && setRestore({ phase: 'running', progress }),
      });
      if (alive()) setRestore({ phase: 'done' });
    } catch {
      if (alive()) setRestore({ phase: 'failed' });
    }
  }, [client, alive]);

  const [unlockState, unlock] = useAsyncCallback(
    useCallback(
      async (input: string) => {
        const key = await keyFromRecoveryInput(client, input, keyContent);
        await unlockWithRecoveryKey(client, keyId, key);
      },
      [client, keyId, keyContent]
    )
  );

  const loading = unlockState.status === AsyncStatus.Loading;

  const submit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const field = new FormData(evt.currentTarget).get('recoveryInput');
    const value = typeof field === 'string' ? field.trim() : '';
    if (!value || loading) return;
    onUnlockStarted?.();
    unlock(value)
      .then(() => {
        // The restore runs even when the form is gone by now; its state updates are guarded.
        if (alive()) onUnlocked?.();
        return restoreMessages();
      })
      .catch(() => undefined);
  };

  if (unlockState.status === AsyncStatus.Success) {
    return (
      <Box direction="Column" gap="200">
        <Status tone="Success">{t(`${KEY}.deviceVerified`)}</Status>
        {restore?.phase === 'running' && (
          <Box alignItems="Center" gap="200">
            <Spinner size="100" variant="Secondary" />
            <Text size="T200">
              {t(`${KEY}.restoring`, {
                progress: restore.progress ? progressPercent(restore.progress) : 0,
              })}
            </Text>
          </Box>
        )}
        {restore?.phase === 'done' && <Status tone="Success">{t(`${KEY}.restored`)}</Status>}
        {restore?.phase === 'failed' && (
          <Status tone="Critical">{t(`${KEY}.restoreFailed`)}</Status>
        )}
        {!hasPassphrase && onSetPassword && (
          <Button type="button" variant="Secondary" fill="Soft" onClick={onSetPassword}>
            <Text as="span" size="B400">
              {t(`${KEY}.setPassword`)}
            </Text>
          </Button>
        )}
      </Box>
    );
  }

  const failure =
    unlockState.status === AsyncStatus.Error ? describeFailure(unlockState.error) : undefined;

  return (
    <Box as="form" direction="Column" gap="300" onSubmit={submit}>
      <Box direction="Column" gap="100">
        <Text as="label" htmlFor={inputId} size="L400">
          {t(hasPassphrase ? `${KEY}.passwordLabel` : `${KEY}.keyLabel`)}
        </Text>
        <PasswordInput
          id={inputId}
          name="recoveryInput"
          size="400"
          variant="Background"
          outlined
          required
          autoFocus
          autoComplete="off"
          readOnly={loading}
        />
        {failure && (
          <Status tone="Critical" detailOf={failure.detailOf}>
            {failure.text}
          </Status>
        )}
      </Box>
      <Button
        type="submit"
        variant="Primary"
        disabled={loading}
        before={loading ? <Spinner size="200" variant="Primary" fill="Solid" /> : undefined}
      >
        <Text as="span" size="B400">
          {t(`${KEY}.unlock`)}
        </Text>
      </Button>
    </Box>
  );
}
