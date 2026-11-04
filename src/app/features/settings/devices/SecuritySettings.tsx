import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Text } from 'folds';
import { SettingTile } from '../../../components/setting-tile';
import { DeviceVerificationSetup } from '../../../components/DeviceVerificationSetup';
import { ResetVerificationDialog } from '../../../components/device-verification/ResetVerificationDialog';
import { SecurityOverlay } from '../../../components/device-verification/SecurityOverlay';
import type { OwnDeviceTrust } from '../../../hooks/useOwnDeviceTrust';
import { SettingsCard } from '../SettingsCard';
import { KeyBackupTile } from './KeyBackupTile';

type Step = 'confirm-reset' | 'setup';

/**
 * Sets up cross-signing, secret storage and key backup for an account that has none, or replaces
 * all three after a confirmation when the account already has them.
 */
function DeviceVerificationTile({ crossSigning }: { crossSigning: boolean }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>();
  const close = () => setStep(undefined);

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
            onClick={() => setStep('setup')}
          >
            <Text size="B300">{t('featureUi.settings.devices.verification.enable')}</Text>
          </Button>
        )
      }
    >
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
