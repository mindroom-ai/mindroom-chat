import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { useSetAtom } from 'jotai';
import { useOwnDeviceTrust } from './useOwnDeviceTrust';
import { settingsModalAtom } from '../../navigation/settingsModal';
import { SettingsPages } from '../../navigation/settingsPages';
import { WelcomeNotice } from '../onboarding/WelcomeNotice';
import { recoveryDialogAtom } from '../encryption/recoveryDialog';
import { useRecoveryState } from '../encryption/recoveryState';

/**
 * Home's notice for a new sign-in on an account with cross-signing: until another session or the
 * recovery key verifies this one, it cannot read the account's encrypted history. It goes away by
 * itself once the session is verified.
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
    <WelcomeNotice
      icon={Icons.ShieldUser}
      label={t('nav.unverifiedDevice')}
      action={locked ? t('sharedUi.recoveryPassword.unlockWithPassword') : t('home.device.action')}
      onAction={() =>
        locked
          ? setRecoveryDialog('unlock')
          : openSettings({ initialPage: SettingsPages.PrivacyPage })
      }
      text={t('home.device.text')}
    />
  );
}
