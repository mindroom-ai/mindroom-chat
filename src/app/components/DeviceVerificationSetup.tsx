import React, { FormEventHandler, useCallback, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import FileSaver from 'file-saver';
import FocusTrap from 'focus-trap-react';
import { AuthDict, IAuthData, MatrixError, UIAuthCallback } from 'matrix-js-sdk';
import {
  Box,
  Button,
  Chip,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  color,
  config,
} from 'folds';
import { Dialog, Header } from './glass/GlassPrimitives';
import { PasswordInput } from './password-input';
import { ActionUIA, ActionUIAFlowsLoader } from './ActionUIA';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { useAlive } from '../hooks/useAlive';
import { AsyncStatus, useAsyncCallback } from '../hooks/useAsyncCallback';
import { clearSecretStorageKeys } from '../../client/secretStorageKeys';
import { copyToClipboard } from '../utils/dom';
import { stopPropagation } from '../utils/keyboard';
import { ContainerColor } from '../styles/ContainerColor.css';

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

/** Shows the setup's own failures as one localized message and any other error as sent. */
export const useDeviceVerificationErrorText = () => {
  const { t } = useTranslation();
  return (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    return INTERNAL_ERRORS.has(message)
      ? t('sharedUi.deviceVerificationSetup.unexpectedError')
      : message;
  };
};

type UIARequest = {
  authData: IAuthData;
  resolve: (authDict: AuthDict) => void;
  reject: (error: Error) => void;
};

const getUIAData = (error: unknown): IAuthData | undefined => {
  const data = (error as MatrixError | undefined)?.data as IAuthData | undefined;
  return data?.flows ? data : undefined;
};

type UnsupportedUIAProps = {
  onClose: () => void;
};

/** Says the server asks for auth stages this client cannot complete, and lets the user back out. */
function UnsupportedUIA({ onClose }: UnsupportedUIAProps) {
  const { t } = useTranslation();
  return (
    <Dialog variant="Surface" role="dialog" aria-modal="true">
      <Header style={{ padding: `0 ${config.space.S200} 0 ${config.space.S400}` }} size="500">
        <Box grow="Yes" />
        <IconButton
          size="300"
          radii="300"
          onClick={onClose}








            'sharedUi.deviceVerificationSetup.authenticationStepsToPerformThisActionAreNotSupportedByClient'
          )}
        </Text>
        <Button variant="Secondary" fill="Soft" onClick={onClose}>
          <Text size="B400">{t('sharedUi.deviceVerification.close')}</Text>
        </Button>
      </Box>
    </Dialog>
  );
}

/**
 * Bridges the SDK's user-interactive auth callback to a prompt: `authUploadDeviceSigningKeys`
 * first tries without auth, and each time the server answers with UIA flows it publishes a
 * `pending` request and waits until the user completes or cancels it.
 */
const useCrossSigningAuthPrompt = () => {
  const [pending, setPending] = useState<UIARequest>();

  const askForAuth = useCallback(
    (authData: IAuthData) =>
      new Promise<AuthDict>((resolve, reject) => {
        // Only this request may clear itself; a stale close must not hide a newer prompt.
        const dismiss = () => setPending((current) => (current === request ? undefined : current));
        const request: UIARequest = {
          authData,
          resolve: (authDict) => {
            dismiss();
            resolve(authDict);
          },
          reject: (error) => {
            dismiss();
            reject(error);
          },
        };
        setPending(request);
      }),
    []
  );

  const authUploadDeviceSigningKeys = useCallback<UIAuthCallback<void>>(
    async (makeRequest) => {
      let auth: AuthDict | null = null;
      // The server may want several stages; every answer without flows ends the loop.
      for (;;) {
        try {
          await makeRequest(auth);
          return;
        } catch (error) {
          const authData = getUIAData(error);
          if (!authData) {
            const unauthorized = (error as MatrixError | undefined)?.httpStatus === 401;
            throw unauthorized ? new Error(UIA_WITHOUT_DATA) : error;
          }
          auth = await askForAuth(authData);
        }
      }
    },
    [askForAuth]
  );

  const cancel = () => pending?.reject(new Error(SETUP_AUTH_FAILED));

  return { pending, cancel, authUploadDeviceSigningKeys };
};

type UIAPromptOverlayProps = {
  request: UIARequest;
  onCancel: () => void;
};

/** The auth prompt over the setup dialog; Escape or Close cancels the whole setup. */
function UIAPromptOverlay({ request, onCancel }: UIAPromptOverlayProps) {
  const { authData, resolve } = request;
  const renderUnsupported = () => <UnsupportedUIA onClose={onCancel} />;
  const trapOptions = {
    escapeDeactivates: stopPropagation,
    onDeactivate: onCancel,
    clickOutsideDeactivates: false,
    initialFocus: false as const,
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={trapOptions}>
          <div>
            <ActionUIAFlowsLoader authData={authData} unsupported={renderUnsupported}>
              {(flow) => (
                <ActionUIA
                  ongoingFlow={flow}
                  authData={authData}
                  onCancel={onCancel}
                  action={resolve}
                />
              )}
            </ActionUIAFlowsLoader>
          </div>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

const RECOVERY_DESCRIPTION_TAGS = { b: <b /> };

function SetupVerification({ onComplete }: { onComplete: (recoveryKey: string) => void }) {
  const mx = useMatrixClient();
  const alive = useAlive();
  const { pending, cancel, authUploadDeviceSigningKeys } = useCrossSigningAuthPrompt();
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











        });
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
            <b>{failure}</b>
          </Text>
        )}
      </Box>
      {pending && <UIAPromptOverlay request={pending} onCancel={cancel} />}
    </>
  );
}





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
      <Box




          border: `${config.borderWidth.B300} solid var(--mr-container-line)`,
          wordBreak: 'break-all',
        }}
      >
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
      <Header style={{ padding: `0 ${config.space.S200} 0 ${config.space.S400}` }} size="500">
        <Box grow="Yes">
          <Text size="H4">{t('sharedUi.deviceVerificationSetup.setupDeviceVerification')}</Text>
        </Box>
        <IconButton
          size="300"
          radii="300"
          onClick={onCancel}
          aria-label={t('sharedUi.deviceVerification.close')}
        >
          <Icon src={Icons.Cross} />
        </IconButton>
      </Header>
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
