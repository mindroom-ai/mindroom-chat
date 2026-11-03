import React, { ChangeEvent, ReactNode } from 'react';
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
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { SequenceCardStyle } from '../styles.css';
import { isMacOS } from '../../../utils/user-agent';

const THEME_LABEL_KEYS = {
  'light-theme': 'options.themeName.light',
  'silver-theme': 'options.themeName.silver',
  'dark-theme': 'options.themeName.dark',
  'midnight-theme': 'options.themeName.midnight',
  'butter-theme': 'options.themeName.butter',
} as const;

const selectStyle: React.CSSProperties = { minWidth: '10rem' };

type SectionProps = {
  title: string;
  children: ReactNode;
  /** Shown under the card, inside the section. */
  footer?: ReactNode;
};

/** A labelled card of setting tiles; every section of this page is one. */
function Section({ title, children, footer }: SectionProps) {
  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{title}</Text>
      <SequenceCard














  const [useSystemTheme, setUseSystemTheme] = useSetting(settingsAtom, 'useSystemTheme');
  const [themeId, setThemeId] = useSetting(settingsAtom, 'themeId');
  const [twitterEmoji, setTwitterEmoji] = useSetting(settingsAtom, 'twitterEmoji');

  const systemThemeSwitch = (
    <Switch variant="Primary" value={useSystemTheme} onChange={setUseSystemTheme} />
  );

  return (
    <Section title={t('settings.general.appearance.sectionTitle')}>
      <SettingTile
        title={t('settings.general.appearance.systemTheme')}
        description={t('settings.general.appearance.systemThemeDescription')}
        after={systemThemeSwitch}
      />
      {!useSystemTheme && (
        <SettingTile
          title={t('settings.general.appearance.theme')}
          after={
            <select
              style={selectStyle}
              value={themeId ?? 'light-theme'}
              aria-label={t('settings.general.appearance.theme')}
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
    </Section>
  );
}

function Language() {
  const { t, i18n } = useTranslation();
  const languageCode = useAppLanguageCode();

  return (
    <Section title={t('settings.general.language.sectionTitle')}>
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
    </Section>
  );
}

/** Composer keys and formatting, the clock, link previews, and MindRoom's prefetch options. */







  return (
    <Section
      title={t('settings.general.editor.sectionTitle')}
      footer={<MindroomGeneralMessageSettings className={SequenceCardStyle} />}
    >
      <SettingTile
        title={t('settings.general.editor.enterForNewline')}
        description={t('settings.general.editor.enterForNewlineDescription', {
          sendKey: isMacOS() ? 'Cmd' : 'Ctrl',
        })}
        after={<Switch variant="Primary" value={enterForNewline} onChange={setEnterForNewline} />}
      />
      <SettingTile
        title={t('settings.general.editor.markdownFormatting')}
        after={<Switch variant="Primary" value={isMarkdown} onChange={setIsMarkdown} />}
      />
      <SettingTile
        title={t('settings.general.dateTime.hour24Clock')}
        after={<Switch variant="Primary" value={hour24Clock} onChange={setHour24Clock} />}
      />
      <SettingTile
        title={t('settings.general.messages.urlPreview')}
        after={<Switch variant="Primary" value={urlPreview} onChange={setUrlPreview} />}
      />
    </Section>
  );
}

/** Appearance, language, MindRoom's interface options, and the editor. */
export function General({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame title={t('settings.nav.general')} requestClose={requestClose}>
      <Appearance />
      <Language />
      <MindroomInterfaceSettings className={SequenceCardStyle} />
      <Editor />
    </SettingsPageFrame>
  );
}
