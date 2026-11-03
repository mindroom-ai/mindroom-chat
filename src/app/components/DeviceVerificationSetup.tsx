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
          aria-label={t('sharedUi.deviceVerification.close')}
        >
          <Icon src={Icons.Cross} />
        </IconButton>
      </Header>
      <Box direction="Column" style={{ padding: config.space.S400 }}>
        <Text size="T300" style={{ color: color.Critical.Main }}>
          {t(
            'sharedUi.deviceVerificationSetup.authenticationStepsToPerformThisActionAreNotSupportedByClient'
          )}
        </Text>
      </Box>
    </Dialog>











  const errorText = useDeviceVerificationErrorText();
  const [uiaRequest, setUIARequest] = useState<UIARequest>();

  const authUploadDeviceSigningKeys: UIAuthCallback<void> = useCallback(async (makeRequest) => {
    try {
      await makeRequest(null);
      return;
    } catch (error) {
      const authData = getUIAData(error);
      if (!authData) throw error;
      const authDict = await new Promise<AuthDict>((resolve, reject) => {
        setUIARequest({ authData, resolve, reject });
      }).finally(() => setUIARequest(undefined));
      if (Object.keys(authDict).length === 0) throw new Error(UIA_WITHOUT_DATA);
      try {
        await makeRequest(authDict);
      } catch {
        throw new Error(SETUP_AUTH_FAILED);
      }
    }
  }, []);

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
  const loading = setupState.status === AsyncStatus.Loading;
  const cancelUIA = () => uiaRequest?.reject(new Error(SETUP_AUTH_FAILED));




    const { passphraseInput } = evt.target as HTMLFormElement & {
      passphraseInput?: HTMLInputElement;
    };
    const passphrase = passphraseInput?.value.trim();
    setup(passphrase || undefined).catch(() => undefined);
  };

  return (
    <>
      <Box as="form" direction="Column" gap="400" onSubmit={handleSubmit}>
        <Text size="T300">
          <Trans
            i18nKey="sharedUi.deviceVerificationSetup.recoveryDescription"
            components={{ b: <b /> }}
          />
        </Text>
        <Box direction="Column" gap="100">
          <Text size="L400">{t('sharedUi.deviceVerificationSetup.passphraseOptional')}</Text>
          <PasswordInput
            name="passphraseInput"
            variant="Background"
            size="400"
            outlined
            autoComplete="new-password"














          </Text>
        )}
      </Box>
      {/* The password stage has its own form, so the dialog sits beside this one. Cancelling
          rejects the pending request, which fails the setup and stops its spinner; a reject after
          the request resolved (the trap deactivates on unmount) does nothing. */}
      {uiaRequest && (
        <Overlay open backdrop={<OverlayBackdrop />}>
          <OverlayCenter>
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                onDeactivate: cancelUIA,
                escapeDeactivates: stopPropagation,
              }}
            >
              <div>
                <ActionUIAFlowsLoader
                  authData={uiaRequest.authData}
                  unsupported={() => <UnsupportedUIA onClose={cancelUIA} />}
                >
                  {(ongoingFlow) => (
                    <ActionUIA
                      authData={uiaRequest.authData}
                      ongoingFlow={ongoingFlow}
                      action={uiaRequest.resolve}
                      onCancel={cancelUIA}
                    />
                  )}
                </ActionUIAFlowsLoader>
              </div>
            </FocusTrap>
          </OverlayCenter>
        </Overlay>
      )}
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
