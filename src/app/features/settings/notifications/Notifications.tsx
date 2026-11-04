import { useTranslation } from 'react-i18next';
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { SystemNotification } from './SystemNotification';
import {
  AllMessagesNotifications,
  KeywordNotifications,
  SpecialMessagesNotifications,
} from './PushRuleSettings';

/** How this device notifies, and the account's push rules for messages, mentions and keywords. */
export function Notifications({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame title={t('settings.nav.notifications')} requestClose={requestClose}>
      <SystemNotification />
      <AllMessagesNotifications />
      <SpecialMessagesNotifications />
      <KeywordNotifications />
    </SettingsPageFrame>
  );
}
