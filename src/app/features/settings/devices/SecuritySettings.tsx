import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Spinner, Text, color } from 'folds';
import { SettingTile } from '../../../components/setting-tile';
import { DeviceVerificationSetup } from '../../../components/DeviceVerificationSetup';
import { ResetVerificationDialog } from '../../../components/device-verification/ResetVerificationDialog';
import { SecurityOverlay } from '../../../components/device-verification/SecurityOverlay';
import type { OwnDeviceTrust } from '../../../hooks/useOwnDeviceTrust';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAlive } from '../../../hooks/useAlive';
import { SettingsCard } from '../SettingsCard';
import { KeyBackupTile } from './KeyBackupTile';
import { hasServerEncryptionSetup } from './serverEncryptionSetup';

type Step = 'confirm-reset' | 'setup';

/**
 * Sets up cross-signing, secret storage and key backup for an account that has none, or replaces
 * all three after a confirmation when the account already has them.
 *
 * `crossSigning` is this session's view, which can lag the server: right after sign-in it may not
 * know the account's keys yet. So "Enable" asks the server when clicked, and an account that has
 * any of the three gets the reset warning first.
 */
function DeviceVerificationTile({ crossSigning }: { crossSigning: boolean }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const [step, setStep] = useState<Step>();
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const close = () => setStep(undefined);

  const enable = () => {
    if (checking) return;
    setChecking(true);
    setCheckFailed(false);
    hasServerEncryptionSetup(client)
      .then(
        (existing) => alive() && setStep(existing ? 'confirm-reset' : 'setup'),
        () => alive() && setCheckFailed(true)
      )
      .finally(() => alive() && setChecking(false));
  };

  return (
    <SettingTile
      title={t('featureUi.settings.devices.deviceVerification')}
      description={t('featureUi.settings.devices.toVerifyDeviceIdentityAndGrantAccess')}
      after={
        crossSigning ? (
          <Button
            size="300"
            radii="300"
            variant="Critical"
            fill="Soft"
            onClick={() => setStep('confirm-reset')}
          >
            <Text size="B300">{t('featureUi.settings.devices.verification.reset')}</Text>
          </Button>
        ) : (
          <Button
            size="300"
            radii="300"
            variant="Primary"
            fill="Solid"
            disabled={checking}
            before={checking ? <Spinner size="50" variant="Primary" fill="Solid" /> : undefined}
            onClick={enable}
          >
            <Text size="B300">{t('featureUi.settings.devices.verification.enable')}</Text>
          </Button>
        )
      }
    >
      {checkFailed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t('featureUi.settings.devices.verification.checkFailed')}
        </Text>
      )}
      {step && (
        <SecurityOverlay onClose={close}>
          {step === 'confirm-reset' ? (
            <ResetVerificationDialog onReset={() => setStep('setup')} onCancel={close} />
          ) : (
            <DeviceVerificationSetup onCancel={close} />
          )}
        </SecurityOverlay>
      )}
    </SettingTile>
  );
}

/** The Security group at the top of the device settings. */
export function SecuritySettings({ trust }: { trust: OwnDeviceTrust }) {
  const { t } = useTranslation();
  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.devices.security')}</Text>
      <SettingsCard>
        <DeviceVerificationTile crossSigning={trust.crossSigning} />
        {trust.crossSigning && <KeyBackupTile />}
      </SettingsCard>
    </Box>
  );
}
