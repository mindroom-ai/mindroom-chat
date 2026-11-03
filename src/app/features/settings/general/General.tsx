import React, { ChangeEvent } from 'react';
import { Box, Switch, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { THEMES } from '../../../hooks/useTheme';
import { APP_LANGUAGES } from '../../../i18nLanguages';
import { useAppLanguageCode } from '../../../hooks/useAppLanguageCode';
import {
  MindroomGeneralMessageSettings,
  MindroomInterfaceSettings,
} from '../../../mindroom/settings/settingsExtensions';
import { SettingsPageFrame } from '../SettingsPageFrame';
import { SequenceCardStyle } from '../styles.css';

const THEME_LABEL_KEYS = {
  'light-theme': 'featureUi.settings.general.appearance.themes.light',
  'silver-theme': 'featureUi.settings.general.appearance.themes.silver',
  'dark-theme': 'featureUi.settings.general.appearance.themes.dark',
  'midnight-theme': 'featureUi.settings.general.appearance.themes.midnight',
  'butter-theme': 'featureUi.settings.general.appearance.themes.butter',
} as const;

const selectStyle: React.CSSProperties = { minWidth: '10rem' };

function Appearance() {
  const { t } = useTranslation();
  const [useSystemTheme, setUseSystemTheme] = useSetting(settingsAtom, 'useSystemTheme');
  const [themeId, setThemeId] = useSetting(settingsAtom, 'themeId');
  const [twitterEmoji, setTwitterEmoji] = useSetting(settingsAtom, 'twitterEmoji');

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.general.appearance.sectionTitle')}</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title={t('featureUi.settings.general.appearance.systemTheme')}
          description={t('featureUi.settings.general.appearance.systemThemeDescription')}
          after={<Switch variant="Primary" value={useSystemTheme} onChange={setUseSystemTheme} />}
        />
        {!useSystemTheme && (
          <SettingTile
            title={t('featureUi.settings.general.appearance.theme')}
            after={
              <select
                style={selectStyle}
                value={themeId ?? 'light-theme'}
                aria-label={t('featureUi.settings.general.appearance.theme')}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => setThemeId(event.target.value)}
              >
                {THEMES.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {t(
                      THEME_LABEL_KEYS[theme.id as keyof typeof THEME_LABEL_KEYS] ??
                        THEME_LABEL_KEYS['light-theme']
                    )}
                  </option>
                ))}
              </select>
            }
          />
        )}
        <SettingTile
          title={t('settings.general.appearance.twitterEmoji')}
          after={<Switch variant="Primary" value={twitterEmoji} onChange={setTwitterEmoji} />}
        />
      </SequenceCard>
    </Box>
  );
}

function Language() {
  const { t, i18n } = useTranslation();
  const languageCode = useAppLanguageCode();

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('settings.general.language.sectionTitle')}</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title={t('settings.general.language.appLanguage')}
          after={
            <select
              style={selectStyle}
              value={languageCode}
              aria-label={t('settings.general.language.appLanguage')}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                void i18n.changeLanguage(event.target.value);
              }}
            >
              {APP_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code} lang={language.code}>
                  {language.nativeName}
                </option>
              ))}
            </select>
          }
        />
      </SequenceCard>
    </Box>
  );
}








  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.general.messages.sectionTitle')}</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title={t('featureUi.settings.general.messages.enterForNewline')}
          description={t('featureUi.settings.general.messages.enterForNewlineDescription')}
          after={<Switch variant="Primary" value={enterForNewline} onChange={setEnterForNewline} />}
        />
        <SettingTile
          title={t('featureUi.settings.general.messages.markdown')}
          after={<Switch variant="Primary" value={isMarkdown} onChange={setIsMarkdown} />}
        />
        <SettingTile
          title={t('featureUi.settings.general.messages.hour24Clock')}
          after={<Switch variant="Primary" value={hour24Clock} onChange={setHour24Clock} />}
        />
        <SettingTile
          title={t('featureUi.settings.general.messages.urlPreview')}
          after={<Switch variant="Primary" value={urlPreview} onChange={setUrlPreview} />}
        />
      </SequenceCard>











  return (
    <SettingsPageFrame title={t('featureUi.settings.menu.general')} requestClose={requestClose}>
      <Appearance />
      <Language />
      <MindroomInterfaceSettings className={SequenceCardStyle} />
      <Editor />
    </SettingsPageFrame>
  );
}
