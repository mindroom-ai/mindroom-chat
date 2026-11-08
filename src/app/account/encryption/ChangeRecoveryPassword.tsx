import { FormEventHandler, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Spinner, Text, color, config } from 'folds';
import type { GeneratedSecretStorageKey } from 'matrix-js-sdk/lib/crypto-api';
import { Dialog } from '../../ui/glass/GlassPrimitives';
import { PasswordInput } from '../../ui/PasswordInput';
import { ErrorDetail } from '../../ui/ErrorDetail';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../lib/hooks/useAlive';
import { AsyncStatus, useAsyncCallback } from '../../lib/hooks/useAsyncCallback';
import { DialogTitleBar } from '../verification/DialogTitleBar';
import { storePrivateKey } from '../../matrix/client/secretStorageKeys';
import { keyFromRecoveryInput } from './recoveryInput';
import { errorMessage } from '../../lib/errorMessage';
import {
  CRYPTO_NOT_FOUND,
  RECOVERY_KEY_FAILED,
  RECOVERY_SECRETS_NOT_CACHED,
  storeSecretsUnderNewKey,
} from './recoveryPassword';
import type { DefaultSecretStorageKey } from './recoveryState';
import { unlockWithRecoveryKey } from './unlockWithRecoveryKey';
import { NewRecoveryPasswordFields, readNewRecoveryPassword } from './NewRecoveryPasswordFields';
import { RecoverySavedStep } from './RecoverySavedStep';
import { useRecoveryFailureText } from './useRecoveryFailureText';

const KEY = 'sharedUi.recoveryPassword';

// Refusals that come before anything is written, which the same key would only meet again.
const WROTE_NOTHING: ReadonlySet<string> = new Set([RECOVERY_SECRETS_NOT_CACHED, CRYPTO_NOT_FOUND]);

function Failure({ error }: { error: unknown }) {
  const describeFailure = useRecoveryFailureText();
  const { text, detailOf } = describeFailure(error);
  return (
    <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
      <b>{text}</b>
      <ErrorDetail error={detailOf} />
    </Text>
  );
}

type StepProps = {
  onCancel: () => void;
  /** Told when the step starts and stops running. */
  onRunningChange: (running: boolean) => void;
};

type CurrentStepProps = StepProps & {
  secretStorageKey: DefaultSecretStorageKey;
  onUnlocked: () => void;
};

/** Proves the person knows the current recovery password (or key) and unlocks this session with it. */
function CurrentStep({
  secretStorageKey,
  onUnlocked,
  onCancel,
  onRunningChange,
}: CurrentStepProps) {
  const { keyId, keyContent, hasPassphrase } = secretStorageKey;
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const inputId = useId();

  const [state, unlock] = useAsyncCallback(
    useCallback(
      async (input: string) => {
        const key = await keyFromRecoveryInput(client, input, keyContent);
        // A session that holds the cross-signing keys needs no unlock; after a Change that failed
        // part way they may sit under the old key only, where unlocking with the new one fails.
        const crypto = client.getCrypto();
        if (!crypto) throw new Error(CRYPTO_NOT_FOUND);
        const { privateKeysCachedLocally: held } = await crypto.getCrossSigningStatus();
        if (held.masterKey && held.selfSigningKey && held.userSigningKey) {
          storePrivateKey(keyId, key);
          // The backup key cached here may be stale or missing (another session may have replaced
          // the backup); the one in secret storage is current. Without one the change refuses.
          await crypto.loadSessionBackupPrivateKeyFromSecretStorage().catch(() => undefined);
        } else {
          await unlockWithRecoveryKey(client, keyId, key);
        }
        if (alive()) onUnlocked();
      },
      [client, keyId, keyContent, alive, onUnlocked]
    )
  );
  const busy = state.status === AsyncStatus.Loading;
  useEffect(() => onRunningChange(busy), [busy, onRunningChange]);

  const submit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    const field = new FormData(evt.currentTarget).get('recoveryInput');
    const value = typeof field === 'string' ? field.trim() : '';
    if (!value || busy) return;
    unlock(value).catch(() => undefined);
  };

  return (
    <Box as="form" onSubmit={submit} direction="Column" gap="400">
      <Text size="T300">{t(`${KEY}.changeIntro`)}</Text>
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
          readOnly={busy}
        />
      </Box>
      <Button
        type="submit"
        variant="Primary"
        disabled={busy}
        before={busy ? <Spinner size="200" variant="Primary" fill="Solid" /> : undefined}
      >
        <Text size="B400">{t('sharedUi.deviceVerificationSetup.continue')}</Text>
      </Button>
      {!busy && (
        <Button type="button" variant="Secondary" fill="None" onClick={onCancel}>
          <Text size="B400">{t(`${KEY}.notNow`)}</Text>
        </Button>
      )}
      {state.status === AsyncStatus.Error && <Failure error={state.error} />}
    </Box>
  );
}

type NewStepProps = StepProps & { onChanged: (recoveryKey: string) => void };

/** Derives the key of the new password once, then writes this session's secrets under it. */
function NewStep({ onChanged, onCancel, onRunningChange }: NewStepProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  // Kept so that Retry writes under the very key made from the typed password.
  const newKey = useRef<GeneratedSecretStorageKey>();
  const [inputError, setInputError] = useState<'tooShort' | 'mismatch'>();

  const [state, change] = useAsyncCallback(
    useCallback(
      async (password?: string) => {
        const crypto = client.getCrypto();
        if (!crypto) throw new Error(CRYPTO_NOT_FOUND);
        if (!newKey.current) {
          const made = await crypto.createRecoveryKeyFromPassphrase(password);
          if (!made.encodedPrivateKey) throw new Error(RECOVERY_KEY_FAILED);
          newKey.current = made;
        }
        const key = newKey.current;
        try {
          await storeSecretsUnderNewKey(client, key);
        } catch (error) {
          // Nothing was written, so the next try starts over from the typed password.
          if (WROTE_NOTHING.has(errorMessage(error))) newKey.current = undefined;
          throw error;
        }
        if (alive() && key.encodedPrivateKey) onChanged(key.encodedPrivateKey);
      },
      [client, alive, onChanged]
    )
  );
  const busy = state.status === AsyncStatus.Loading;
  useEffect(() => onRunningChange(busy), [busy, onRunningChange]);
  const retrying = state.status === AsyncStatus.Error && newKey.current !== undefined;

  const submit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (busy) return;
    if (retrying) {
      change().catch(() => undefined);
      return;
    }
    const read = readNewRecoveryPassword(evt.currentTarget);
    if ('error' in read) {
      setInputError(read.error);
      return;
    }
    setInputError(undefined);
    change(read.password).catch(() => undefined);
  };

  return (
    <Box as="form" onSubmit={submit} direction="Column" gap="400">
      <Text size="T300">{t(`${KEY}.newIntro`)}</Text>
      <NewRecoveryPasswordFields disabled={busy || newKey.current !== undefined} />
      <Button
        type="submit"
        variant="Primary"
        disabled={busy}
        before={busy ? <Spinner size="200" variant="Primary" fill="Solid" /> : undefined}
      >
        <Text size="B400">{retrying ? t('sharedUi.clientRoot.retry') : t(`${KEY}.change`)}</Text>
      </Button>
      {!busy && (
        <Button type="button" variant="Secondary" fill="None" onClick={onCancel}>
          <Text size="B400">{t(`${KEY}.notNow`)}</Text>
        </Button>
      )}
      {inputError !== undefined && (
        <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
          <b>{t(`${KEY}.${inputError}`)}</b>
        </Text>
      )}
      {state.status === AsyncStatus.Error && <Failure error={state.error} />}
    </Box>
  );
}

type ChangeRecoveryPasswordProps = {
  secretStorageKey: DefaultSecretStorageKey;
  /** False right after an unlock in the same flow, whose secrets this session holds. */
  askCurrent: boolean;
  onClose: () => void;
  /**
   * Told whether the dialog must stay open: while a step runs and until the new recovery password
   * is saved, since closing then loses the key. Its close button is gone meanwhile.
   */
  onKeepOpenChange?: (keepOpen: boolean) => void;
};

/**
 * Changes the recovery password, or adds one to an account that has a recovery key only. The
 * secrets move to a new secret storage key, so no message history is lost.
 */
export function ChangeRecoveryPassword({
  secretStorageKey,
  askCurrent,
  onClose,
  onKeepOpenChange,
}: ChangeRecoveryPasswordProps) {
  const { t } = useTranslation();
  const [unlocked, setUnlocked] = useState(!askCurrent);
  const [recoveryKey, setRecoveryKey] = useState<string>();
  const [running, setRunning] = useState(false);
  const keepOpen = running || recoveryKey !== undefined;

  useEffect(() => {
    onKeepOpenChange?.(keepOpen);
    return () => onKeepOpenChange?.(false);
  }, [keepOpen, onKeepOpenChange]);

  const markUnlocked = useCallback(() => setUnlocked(true), []);

  let step;
  if (recoveryKey !== undefined) {
    step = <RecoverySavedStep recoveryKey={recoveryKey} onDone={onClose} />;
  } else if (unlocked) {
    step = <NewStep onChanged={setRecoveryKey} onCancel={onClose} onRunningChange={setRunning} />;
  } else {
    step = (
      <CurrentStep
        secretStorageKey={secretStorageKey}
        onUnlocked={markUnlocked}
        onCancel={onClose}
        onRunningChange={setRunning}
      />
    );
  }

  return (
    <Dialog variant="Surface" role="dialog" aria-modal="true">
      <DialogTitleBar onClose={keepOpen ? undefined : onClose}>
        <Text size="H4">{t(`${KEY}.changeTitle`)}</Text>
      </DialogTitleBar>
      <Box direction="Column" style={{ padding: config.space.S400 }}>
        {step}
      </Box>
    </Dialog>
  );
}
