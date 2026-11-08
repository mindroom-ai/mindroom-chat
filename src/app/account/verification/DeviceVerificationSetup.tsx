import { FormEventHandler, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatrixError, UIAuthCallback } from 'matrix-js-sdk';
import { Box, Button, Spinner, Text, color, config } from 'folds';
import { Dialog } from '../../ui/glass/GlassPrimitives';
import { DialogTitleBar } from './DialogTitleBar';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../lib/hooks/useAlive';
import { AsyncStatus, useAsyncCallback } from '../../lib/hooks/useAsyncCallback';
import { AuthenticationCancelled, useAuthenticatedAction } from '../uia/useAuthenticatedAction';
import { errorMessage } from '../../lib/errorMessage';
import { describeKnownError } from '../../lib/describeError';
import { ErrorDetail } from '../../ui/ErrorDetail';
import {
  CRYPTO_NOT_FOUND,
  RECOVERY_KEY_FAILED,
  setUpRecovery,
} from '../encryption/recoveryPassword';
import {
  NewRecoveryPasswordFields,
  readNewRecoveryPassword,
} from '../encryption/NewRecoveryPasswordFields';
import { RecoverySavedStep } from '../encryption/RecoverySavedStep';
import { hasServerEncryptionSetup } from '../devices/serverEncryptionSetup';

// Thrown in English and translated when shown, so a retained error follows language changes.
const UIA_WITHOUT_DATA = 'Unexpected Error! UIA action is perform without data.';
const SETUP_AUTH_FAILED = 'Authentication failed! Failed to setup device verification.';
const SETUP_CHECK_FAILED = "Couldn't check your encryption setup.";
const INTERNAL_ERRORS: ReadonlySet<string> = new Set([
  UIA_WITHOUT_DATA,
  SETUP_AUTH_FAILED,
  CRYPTO_NOT_FOUND,
  RECOVERY_KEY_FAILED,
]);

/**
 * Shows the setup's own failures as one localized message, the ones `describeKnownError`
 * recognizes in words with the error's text beside them, and any other error as sent.
 */
const useDeviceVerificationErrorText = () => {
  const { t } = useTranslation();
  return (error: unknown): { text: string; detailOf?: unknown } => {
    const message = errorMessage(error);
    if (message === SETUP_CHECK_FAILED) {
      return { text: t('sharedUi.recoveryPassword.setupCheckFailed') };
    }
    if (INTERNAL_ERRORS.has(message)) {
      return { text: t('sharedUi.deviceVerificationSetup.unexpectedError') };
    }
    const known = describeKnownError(t, error);
    return known === undefined ? { text: message } : { text: known, detailOf: error };
  };
};

/** The setup's own failure for an authentication that did not go through. */
const toSetupAuthError = (error: unknown): unknown => {
  if (error instanceof AuthenticationCancelled) return new Error(SETUP_AUTH_FAILED);
  // Refused without flows: the server did not say how to authenticate.
  if ((error as MatrixError | undefined)?.httpStatus === 401) return new Error(UIA_WITHOUT_DATA);
  return error;
};

type PasswordSetupProps = {
  /** Asks the server again at Continue whether the account is set up already. */
  confirmFresh: boolean;
  /** Told, instead of setting up, that the server has an encryption setup after all. */
  onExisting: () => void;
  /** Told when the setup starts and stops running. */
  onRunningChange: (running: boolean) => void;
  /** Gets the encoded recovery key once everything is set up. */
  onComplete: (recoveryKey: string) => void;
  /** Closes the dialog before anything runs. */
  onCancel: () => void;
};

function SetupVerification({
  onCancel,
  onComplete,
  onRunningChange,
  confirmFresh,
  onExisting,
}: PasswordSetupProps) {
  const mx = useMatrixClient();
  const alive = useAlive();
  // The SDK first tries the upload without auth; each stage the server then asks for is
  // prompted for, and closing the prompt stops the setup.
  const { run, prompt } = useAuthenticatedAction();
  const authUploadDeviceSigningKeys = useCallback<UIAuthCallback<void>>(
    (makeRequest) =>
      run((auth) => makeRequest(auth ?? null)).catch((error: unknown) => {
        throw toSetupAuthError(error);
      }),
    [run]
  );
  const { t } = useTranslation();
  const describeError = useDeviceVerificationErrorText();

  const [setupState, setup] = useAsyncCallback(
    useCallback(
      async (password: string) => {
        if (confirmFresh) {
          const existing = await hasServerEncryptionSetup(mx).catch(() => {
            throw new Error(SETUP_CHECK_FAILED);
          });
          if (existing) {
            if (alive()) onExisting();
            return;
          }
        }
        const recoveryKey = await setUpRecovery(mx, password, authUploadDeviceSigningKeys);
        if (alive()) onComplete(recoveryKey);
      },
      [mx, alive, authUploadDeviceSigningKeys, onComplete, confirmFresh, onExisting]
    )
  );
  const [inputError, setInputError] = useState<'tooShort' | 'mismatch'>();
  const busy = setupState.status === AsyncStatus.Loading;
  useEffect(() => onRunningChange(busy), [busy, onRunningChange]);
  const failure =
    setupState.status === AsyncStatus.Error ? describeError(setupState.error) : undefined;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (busy) return;
    const read = readNewRecoveryPassword(evt.target as HTMLFormElement);
    if ('error' in read) {
      setInputError(read.error);
      return;
    }
    setInputError(undefined);
    setup(read.password).catch(() => undefined);
  };

  const spinner = busy ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined;

  return (
    <>
      <Box as="form" onSubmit={handleSubmit} direction="Column" gap="400">
        <Text size="T300">{t('sharedUi.recoveryPassword.setupIntro')}</Text>
        <NewRecoveryPasswordFields disabled={busy} />
        <Button type="submit" before={spinner} disabled={busy} variant="Primary">
          <Text size="B400">{t('sharedUi.deviceVerificationSetup.continue')}</Text>
        </Button>
        {!busy && (
          <Button type="button" variant="Secondary" fill="None" onClick={onCancel}>
            <Text size="B400">{t('sharedUi.recoveryPassword.notNow')}</Text>
          </Button>
        )}
        {inputError !== undefined && (
          <Text role="alert" style={{ color: color.Critical.Main }} size="T200">
            <b>{t(`sharedUi.recoveryPassword.${inputError}`)}</b>
          </Text>
        )}
        {failure !== undefined && (
          <Text style={{ color: color.Critical.Main }} size="T200">
            <b>{failure.text}</b>
            <ErrorDetail error={failure.detailOf} />
          </Text>
        )}
      </Box>
      {prompt}
    </>
  );
}

type DeviceVerificationSetupProps = {
  onCancel: () => void;
  /**
   * Whether Continue asks the server again, just before setting up, that the account still has no
   * encryption setup: this dialog can sit open while the account is set up on another device, and
   * setting up then replaces that device's keys and deletes its key backup. False only once the
   * person has confirmed replacing the account's setup (the reset warning). Default true.
   */
  confirmFresh?: boolean;
  /**
   * Told, instead of setting up, when that check finds an encryption setup; the caller shows the
   * reset warning. Without it the dialog closes.
   */
  onExistingSetup?: () => void;
  /**
   * Told whether the dialog must stay open: while the setup runs and until the person has saved the recovery password,
   * since closing then loses the key. Its close button is gone meanwhile; Done closes.
   */
  onKeepOpenChange?: (keepOpen: boolean) => void;
};

/**
 * Sets up cross-signing and secret storage for the account under a recovery password, and keeps
 * the recovery key behind a toggle for other apps.
 */
export function DeviceVerificationSetup({
  onCancel,
  confirmFresh = true,
  onExistingSetup,
  onKeepOpenChange,
}: DeviceVerificationSetupProps) {
  const { t } = useTranslation();
  const [recoveryKey, setRecoveryKey] = useState<string>();
  const [running, setRunning] = useState(false);
  const keepOpen = running || recoveryKey !== undefined;

  useEffect(() => {
    onKeepOpenChange?.(keepOpen);
    return () => onKeepOpenChange?.(false);
  }, [keepOpen, onKeepOpenChange]);

  return (
    <Dialog variant="Surface" role="dialog" aria-modal="true">
      <DialogTitleBar onClose={keepOpen ? undefined : onCancel}>
        <Text size="H4">{t('sharedUi.recoveryPassword.setupTitle')}</Text>
      </DialogTitleBar>
      <Box direction="Column" style={{ padding: config.space.S400 }}>
        {recoveryKey ? (
          <RecoverySavedStep recoveryKey={recoveryKey} onDone={onCancel} />
        ) : (
          <SetupVerification
            onCancel={onCancel}
            onComplete={setRecoveryKey}
            onRunningChange={setRunning}
            confirmFresh={confirmFresh}
            onExisting={onExistingSetup ?? onCancel}
          />
        )}
      </Box>
    </Dialog>
  );
}
