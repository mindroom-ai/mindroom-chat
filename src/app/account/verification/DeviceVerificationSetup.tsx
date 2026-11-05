import { CSSProperties, FormEventHandler, ReactNode, useCallback, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import FileSaver from 'file-saver';
import type { MatrixError, UIAuthCallback } from 'matrix-js-sdk';
import { Box, Button, Chip, Icon, IconButton, Icons, Spinner, Text, color, config } from 'folds';
import { Dialog, Header } from '../../ui/glass/GlassPrimitives';
import { PasswordInput } from '../../ui/PasswordInput';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAlive } from '../../lib/hooks/useAlive';
import { AsyncStatus, useAsyncCallback } from '../../lib/hooks/useAsyncCallback';
import { clearSecretStorageKeys } from '../../matrix/client/secretStorageKeys';
import { copyToClipboard } from '../../lib/dom';
import { ContainerColor } from '../../ui/styles/ContainerColor.css';
import {
  AuthenticationCancelled,
  useAuthenticatedAction,
} from '../uia/useAuthenticatedAction';
import { errorMessage } from '../../lib/errorMessage';
import { describeKnownError } from '../../lib/describeError';
import { ErrorDetail } from '../../ui/ErrorDetail';

// Thrown in English and translated when shown, so a retained error follows language changes.
const UIA_WITHOUT_DATA = 'Unexpected Error! UIA action is perform without data.';
const SETUP_AUTH_FAILED = 'Authentication failed! Failed to setup device verification.';
const CRYPTO_NOT_FOUND = 'Unexpected Error! Crypto module not found!';
const RECOVERY_KEY_FAILED = 'Unexpected Error! Failed to create recovery key.';
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

const TITLE_BAR_STYLE = {
  paddingBlock: 0,
  paddingInline: `${config.space.S400} ${config.space.S200}`,
};

type DialogTitleBarProps = {
  onClose: () => void;
  /** The title, before the close button. */
  children?: ReactNode;
};

function DialogTitleBar({ onClose, children }: DialogTitleBarProps) {
  const { t } = useTranslation();
  return (
    <Header size="500" style={TITLE_BAR_STYLE}>
      <Box grow="Yes">{children}</Box>
      <IconButton
        size="300"
        radii="300"
        aria-label={t('sharedUi.deviceVerification.close')}
        onClick={onClose}
      >
        <Icon src={Icons.Cross} />
      </IconButton>
    </Header>
  );
}

const RECOVERY_DESCRIPTION_TAGS = { b: <b /> };

// Both the secret storage and its key backup are created anew, never merged into existing ones.
const FRESH_SECRET_STORAGE = { setupNewSecretStorage: true, setupNewKeyBackup: true } as const;

function SetupVerification({ onComplete }: { onComplete: (recoveryKey: string) => void }) {
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
      async (passphrase?: string) => {
        const crypto = mx.getCrypto();
        if (!crypto) throw new Error(CRYPTO_NOT_FOUND);

        const recoveryKey = await crypto.createRecoveryKeyFromPassphrase(passphrase);
        const { encodedPrivateKey } = recoveryKey;
        if (!encodedPrivateKey) throw new Error(RECOVERY_KEY_FAILED);

        await crypto.bootstrapCrossSigning({
          authUploadDeviceSigningKeys,
          setupNewCrossSigning: true,
        });
        // Keys cached for the previous secret storage cannot open the new one.
        clearSecretStorageKeys();
        const newStorage = {
          ...FRESH_SECRET_STORAGE,
          createSecretStorageKey: async () => recoveryKey,
        };
        await crypto.bootstrapSecretStorage(newStorage);
        if (alive()) onComplete(encodedPrivateKey);
      },
      [mx, alive, authUploadDeviceSigningKeys, onComplete]
    )
  );
  const busy = setupState.status === AsyncStatus.Loading;
  const failure =
    setupState.status === AsyncStatus.Error ? describeError(setupState.error) : undefined;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (evt) => {
    evt.preventDefault();
    if (busy) return;
    const { passphraseInput } = evt.target as HTMLFormElement & {
      passphraseInput?: HTMLInputElement;
    };
    const passphrase = passphraseInput?.value.trim();
    setup(passphrase || undefined).catch(() => undefined);
  };

  const spinner = busy ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined;

  return (
    <>
      <Box as="form" onSubmit={handleSubmit} direction="Column" gap="400">
        <Text size="T300">
          <Trans
            components={RECOVERY_DESCRIPTION_TAGS}
            i18nKey="sharedUi.deviceVerificationSetup.recoveryDescription"
          />
        </Text>
        <Box gap="100" direction="Column">
          <Text size="L400">{t('sharedUi.deviceVerificationSetup.passphraseOptional')}</Text>
          <PasswordInput
            name="passphraseInput"
            autoComplete="new-password"
            disabled={busy}
            size="400"
            variant="Background"
            outlined
          />
        </Box>
        <Button type="submit" before={spinner} disabled={busy} variant="Primary">
          <Text size="B400">{t('sharedUi.deviceVerificationSetup.continue')}</Text>
        </Button>
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

/** `recoveryKey` is the encoded key, shown once. */
type RecoveryKeyDisplayProps = { recoveryKey: string; onDone: () => void };

const RECOVERY_KEY_BOX_STYLE: CSSProperties = {
  padding: config.space.S300,
  border: `${config.borderWidth.B300} solid var(--mr-container-line)`,
  borderRadius: config.radii.R400,
  wordBreak: 'break-all',
};

function RecoveryKeyDisplay({ recoveryKey, onDone }: RecoveryKeyDisplayProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(recoveryKey).then(
      (ok) => setCopied(ok),
      () => undefined
    );
  };
  const handleDownload = () => {
    const blob = new Blob([recoveryKey], { type: 'text/plain;charset=us-ascii' });
    FileSaver.saveAs(blob, 'recovery-key.txt');
  };

  return (
    <Box direction="Column" gap="400">
      <Text size="T300">
        {t('sharedUi.deviceVerificationSetup.storeTheRecoveryKeyInASafePlaceForFutureUseAs')}
      </Text>
      <Box className={ContainerColor({ variant: 'SurfaceVariant' })} style={RECOVERY_KEY_BOX_STYLE}>
        <Text as="code" size="T300">
          {recoveryKey}
        </Text>
      </Box>
      <Box gap="200" wrap="Wrap">
        <Chip
          variant="Secondary"
          radii="Pill"
          onClick={handleCopy}
          after={copied ? <Icon size="50" src={Icons.Check} /> : undefined}
        >
          <Text size="B300">{t('sharedUi.deviceVerificationSetup.copy')}</Text>
        </Chip>
        <Chip variant="Secondary" radii="Pill" onClick={handleDownload}>
          <Text size="B300">{t('sharedUi.deviceVerificationSetup.download')}</Text>
        </Chip>
      </Box>
      <Button variant="Primary" onClick={onDone}>
        <Text size="B400">{t('sharedUi.deviceVerification.okay')}</Text>
      </Button>
    </Box>
  );
}

type DeviceVerificationSetupProps = {
  onCancel: () => void;
};

/**
 * Sets up cross-signing and secret storage for the account and shows the recovery key once.
 * An optional passphrase can stand in for the key later.
 */
export function DeviceVerificationSetup({ onCancel }: DeviceVerificationSetupProps) {
  const { t } = useTranslation();
  const [recoveryKey, setRecoveryKey] = useState<string>();

  return (
    <Dialog variant="Surface" role="dialog" aria-modal="true">
      <DialogTitleBar onClose={onCancel}>
        <Text size="H4">{t('sharedUi.deviceVerificationSetup.setupDeviceVerification')}</Text>
      </DialogTitleBar>
      <Box direction="Column" style={{ padding: config.space.S400 }}>
        {recoveryKey ? (
          <RecoveryKeyDisplay recoveryKey={recoveryKey} onDone={onCancel} />
        ) : (
          <SetupVerification onComplete={setRecoveryKey} />
        )}
      </Box>
    </Dialog>
  );
}
