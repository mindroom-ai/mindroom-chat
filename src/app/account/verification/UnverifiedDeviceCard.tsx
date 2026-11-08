import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Text, color } from 'folds';
import { useSetAtom } from 'jotai';
import { useOwnDeviceTrust } from './useOwnDeviceTrust';
import { settingsModalAtom } from '../../navigation/settingsModal';
import { SettingsPages } from '../../navigation/settingsPages';
import { WelcomeCardStyle } from '../onboarding/welcomeCard';
import { recoveryDialogAtom } from '../encryption/recoveryDialog';
import { useRecoveryState } from '../encryption/recoveryState';

/**
 * The welcome page's banner for a new sign-in on an account with cross-signing: until another
 * session or the recovery key verifies this one, it cannot read the account's encrypted history.
 * It goes away by itself once the session is verified.
 */
export function UnverifiedDeviceCard() {
  const { t } = useTranslation();
  const trust = useOwnDeviceTrust();
  const openSettings = useSetAtom(settingsModalAtom);
  const setRecoveryDialog = useSetAtom(recoveryDialogAtom);
  const recovery = useRecoveryState();

  if (!trust?.crossSigning || trust.thisDeviceVerified) return null;
  const locked = recovery.kind === 'locked';

  return (
    <Box
      direction="Column"
      gap="200"
      style={WelcomeCardStyle}
      role="region"
      aria-label={t('nav.unverifiedDevice')}
    >
      <Box gap="200" alignItems="Center">
        <Icon size="100" src={Icons.ShieldUser} style={{ color: color.Warning.Main }} />
        <Text as="span" size="L400">
          {t('nav.unverifiedDevice')}
        </Text>
      </Box>
      <Text as="span" size="T200" priority="300">
        {t('featureUi.settings.devices.verification.verifyDeviceDescription')}
      </Text>
      <Button
        variant="Warning"
        fill="Soft"
        radii="300"
        outlined
        before={<Icon size="200" src={Icons.ShieldUser} />}
        style={{ justifyContent: 'flex-start' }}
        onClick={() =>
          locked
            ? setRecoveryDialog('unlock')
            : openSettings({ initialPage: SettingsPages.PrivacyPage })
        }
      >
        <Text as="span" size="B300">
          {locked
            ? t('sharedUi.recoveryPassword.unlockWithPassword')
            : t('featureUi.settings.devices.verification.verify')}
        </Text>
      </Button>
    </Box>
  );
}
