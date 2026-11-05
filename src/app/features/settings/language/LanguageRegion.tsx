import { useTranslation } from 'react-i18next';
import { SettingTile } from '../../../components/setting-tile';
import { APP_LANGUAGES } from '../../../i18nLanguages';
import { useAppLanguageCode } from '../../../hooks/useAppLanguageCode';
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { SettingsSection } from '../SettingsSection';
import { SettingSwitchTile } from '../SettingSwitchTile';
import { ChoiceButton } from '../ChoiceButton';
import { DateFormatSetting } from './DateFormatSetting';

function AppLanguageTile() {
  const { t, i18n } = useTranslation();
  const languageCode = useAppLanguageCode();
  const label = t('settings.general.language.appLanguage');

  return (
    <SettingTile
      title={label}
      description={t('settings.general.language.appLanguageDescription')}
      after={
        <ChoiceButton
          label={label}
          value={languageCode}
          choices={APP_LANGUAGES.map(({ code, nativeName }) => ({
            value: code,
            label: nativeName,
            lang: code,
          }))}
          onChoose={(code) => {
            void i18n.changeLanguage(code);
          }}
        />
      }
    />
  );
}

/** The interface language, and how times and dates read in the timeline. */
export function LanguageRegion({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame
      title={t('featureUi.settings.menu.pages.language')}
      requestClose={requestClose}
    >
      <SettingsSection title={t('settings.general.language.sectionTitle')}>
        <AppLanguageTile />
      </SettingsSection>
      <SettingsSection title={t('settings.general.dateTime.sectionTitle')}>
        <SettingSwitchTile
          setting="hour24Clock"
          title={t('settings.general.dateTime.hour24Clock')}
        />
        <DateFormatSetting />
      </SettingsSection>
    </SettingsPageFrame>
  );
}
