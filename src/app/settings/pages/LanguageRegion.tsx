import { useTranslation } from 'react-i18next';
import { Switch } from 'folds';
import { SettingTile } from '../../ui/SettingTile';
import { APP_LANGUAGES } from '../../i18n/i18nLanguages';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { useHour24Clock } from '../../preferences/useHour24Clock';
import { ChoiceButton } from '../../ui/settings/ChoiceButton';
import { DateFormatSetting } from './DateFormatSetting';

function AppLanguageTile() {
  const { t, i18n } = useTranslation();
  const languageCode = useAppLanguageCode();
  const label = t('settings.general.language.appLanguage');

  return (
    <SettingTile
      focusId="language"
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

/** The 24-hour clock switch: on or off as times show now, the language's clock until picked. */
function Hour24ClockTile() {
  const { t } = useTranslation();
  const [on, setOn] = useHour24Clock();
  const title = t('settings.general.dateTime.hour24Clock');
  return (
    <SettingTile
      focusId="hour24Clock"
      title={title}
      after={<Switch variant="Primary" aria-label={title} value={on} onChange={setOn} />}
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
        <Hour24ClockTile />
        <DateFormatSetting />
      </SettingsSection>
    </SettingsPageFrame>
  );
}
