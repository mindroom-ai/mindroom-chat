import React, { ReactNode } from 'react';
import { Box, Switch, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { useSetting } from '../../../state/hooks/settings';
import {
  MessageLayout,
  type MessageSpacing,
  PAGE_ZOOM_DEFAULT,
  type Settings,
  settingsAtom,
} from '../../../state/settings';
import { THEMES, ThemeKind } from '../../../hooks/useTheme';
import { APP_LANGUAGES } from '../../../i18nLanguages';
import { useAppLanguageCode } from '../../../hooks/useAppLanguageCode';
import {
  MindroomGeneralMessageSettings,
  MindroomInterfaceSettings,
} from '../../../mindroom/settings/settingsExtensions';
import { SettingsPageFrame, type SettingsPageProps } from '../SettingsPageFrame';
import { SequenceCardStyle } from '../styles.css';
import { ChoiceButton } from '../ChoiceButton';
import { DateFormatSetting } from './DateFormatSetting';
import { isMacOS } from '../../../utils/user-agent';

const THEME_LABEL_KEYS = {
  'light-theme': 'options.themeName.light',
  'silver-theme': 'options.themeName.silver',
  'dark-theme': 'options.themeName.dark',
  'midnight-theme': 'options.themeName.midnight',
  'butter-theme': 'options.themeName.butter',
} as const;

type ThemeLabelKey = (typeof THEME_LABEL_KEYS)[keyof typeof THEME_LABEL_KEYS];

const themeLabelKey = (themeId: string): ThemeLabelKey =>
  THEME_LABEL_KEYS[themeId as keyof typeof THEME_LABEL_KEYS] ?? THEME_LABEL_KEYS['light-theme'];

const ZOOM_STEPS = [50, 75, 90, 100, 110, 125, 150];

const LAYOUT_CHOICES = [
  [MessageLayout.Modern, 'options.messageLayout.modern'],
  [MessageLayout.Compact, 'options.messageLayout.compact'],
  [MessageLayout.Bubble, 'options.messageLayout.bubble'],
] as const;

const SPACING_CHOICES = [
  ['0', 'options.messageSpacing.none'],
  ['100', 'options.messageSpacing.ultraSmall'],
  ['200', 'options.messageSpacing.extraSmall'],
  ['300', 'options.messageSpacing.small'],
  ['400', 'options.messageSpacing.normal'],
  ['500', 'options.messageSpacing.large'],
] as const satisfies ReadonlyArray<readonly [MessageSpacing, string]>;

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
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        {children}
      </SequenceCard>
      {footer}
    </Box>
  );
}

type SwitchSetting = {
  [K in keyof Settings]-?: Settings[K] extends boolean ? K : never;
}[keyof Settings];

type SwitchTileProps = {
  setting: SwitchSetting;
  title: string;
  description?: string;
  /** The switch shows the opposite of the stored value ("Disable ..." tiles). */
  inverted?: boolean;
};

/** A setting tile whose switch turns one boolean setting on or off. */
function SwitchTile({ setting, title, description, inverted = false }: SwitchTileProps) {
  const [stored, setStored] = useSetting(settingsAtom, setting);

  return (
    <SettingTile
      title={title}
      description={description}
      after={
        <Switch
          variant="Primary"
          aria-label={title}
          value={stored !== inverted}
          onChange={(on: boolean) => setStored(on !== inverted)}
        />
      }
    />
  );
}

type ThemePick = {
  /** The setting that stores this pick. */
  key: 'themeId' | 'lightThemeId' | 'darkThemeId';
  titleKey:
    | 'settings.general.appearance.theme'
    | 'settings.general.appearance.lightTheme'
    | 'settings.general.appearance.darkTheme';
  /** Only themes of this kind are offered; all of them without one. */
  kind?: ThemeKind;
  fallback: string;
};

// With the system theme off, one fixed theme; with it on, a pick for each system mode.
const FIXED_PICKS: ThemePick[] = [
  { key: 'themeId', titleKey: 'settings.general.appearance.theme', fallback: 'light-theme' },
];
const SYSTEM_PICKS: ThemePick[] = [
  {
    key: 'lightThemeId',
    titleKey: 'settings.general.appearance.lightTheme',
    kind: ThemeKind.Light,
    fallback: 'light-theme',
  },
  {
    key: 'darkThemeId',
    titleKey: 'settings.general.appearance.darkTheme',
    kind: ThemeKind.Dark,
    fallback: 'dark-theme',
  },
];

/** One theme picker tile; the fixed theme explains when it applies. */
function ThemePickTile({ pick }: { pick: ThemePick }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useSetting(settingsAtom, pick.key);
  const title = t(pick.titleKey);
  const offered = THEMES.filter((theme) => pick.kind === undefined || theme.kind === pick.kind);

  return (
    <SettingTile
      title={title}
      description={
        pick.kind === undefined ? t('settings.general.appearance.themeDescription') : undefined
      }
      after={
        <ChoiceButton
          label={title}
          value={picked ?? pick.fallback}
          choices={offered.map((theme) => ({ value: theme.id, label: t(themeLabelKey(theme.id)) }))}
          onChoose={setPicked}
        />
      }
    />
  );
}

function ThemeTiles() {
  const { t } = useTranslation();
  const [followSystem, setFollowSystem] = useSetting(settingsAtom, 'useSystemTheme');
  const systemTitle = t('settings.general.appearance.systemTheme');

  return (
    <>
      <SettingTile
        title={systemTitle}
        description={t('settings.general.appearance.systemThemeDescription')}
        after={
          <Switch
            variant="Primary"
            aria-label={systemTitle}
            value={followSystem}
            onChange={setFollowSystem}
          />
        }
      />
      {(followSystem ? SYSTEM_PICKS : FIXED_PICKS).map((pick) => (
        <ThemePickTile key={pick.key} pick={pick} />
      ))}
    </>
  );
}

function PageZoomTile() {
  const { t } = useTranslation();
  const [pageZoom, setPageZoom] = useSetting(settingsAtom, 'pageZoom');
  // A pinch on a phone can store a value between the steps; it stays selectable.
  const steps = ZOOM_STEPS.includes(pageZoom)
    ? ZOOM_STEPS
    : [...ZOOM_STEPS, pageZoom].sort((a, b) => a - b);
  const label = t('settings.general.appearance.pageZoom');

  return (
    <SettingTile
      title={label}
      after={
        <ChoiceButton
          label={label}
          value={pageZoom ?? PAGE_ZOOM_DEFAULT}
          choices={steps.map((step) => ({ value: step, label: `${step}%` }))}
          onChoose={setPageZoom}
        />
      }
    />
  );
}

function AppearanceSettings() {
  const { t } = useTranslation();
  return (
    <Section title={t('settings.general.appearance.sectionTitle')}>
      <ThemeTiles />
      <PageZoomTile />
    </Section>
  );
}

function LanguageSettings() {
  const { t, i18n } = useTranslation();
  const languageCode = useAppLanguageCode();
  const label = t('settings.general.language.appLanguage');

  return (
    <Section title={t('settings.general.language.sectionTitle')}>
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
    </Section>
  );
}

function DateTimeSettings() {
  const { t } = useTranslation();
  return (
    <Section title={t('settings.general.dateTime.sectionTitle')}>
      <SwitchTile setting="hour24Clock" title={t('settings.general.dateTime.hour24Clock')} />
      <DateFormatSetting />
    </Section>
  );
}

/** Composer keys and formatting, and whether others see typing and read receipts. */
function EditorSettings() {
  const { t } = useTranslation();
  const sendKey = isMacOS() ? 'Cmd' : 'Ctrl';

  return (
    <Section title={t('settings.general.editor.sectionTitle')}>
      <SwitchTile
        setting="enterForNewline"
        title={t('settings.general.editor.enterForNewline')}
        description={t('settings.general.editor.enterForNewlineDescription', { sendKey })}
      />
      <SwitchTile setting="isMarkdown" title={t('settings.general.editor.markdownFormatting')} />
      <SwitchTile
        setting="hideActivity"
        title={t('settings.general.editor.hideActivity')}
        description={t('settings.general.editor.hideActivityDescription')}
      />
    </Section>
  );
}

function MessageDisplayTiles() {
  const { t } = useTranslation();
  const [layout, setLayout] = useSetting(settingsAtom, 'messageLayout');
  const [spacing, setSpacing] = useSetting(settingsAtom, 'messageSpacing');
  const layoutLabel = t('settings.general.messages.messageLayout');
  const spacingLabel = t('settings.general.messages.messageSpacing');

  return (
    <>
      <SettingTile
        title={layoutLabel}
        after={
          <ChoiceButton
            label={layoutLabel}
            value={layout}
            choices={LAYOUT_CHOICES.map(([value, key]) => ({ value, label: t(key) }))}
            onChoose={setLayout}
          />
        }
      />
      <SettingTile
        title={spacingLabel}
        after={
          <ChoiceButton
            label={spacingLabel}
            value={spacing}
            choices={SPACING_CHOICES.map(([value, key]) => ({ value, label: t(key) }))}
            onChoose={setSpacing}
          />
        }
      />
    </>
  );
}

/** What the timeline shows, and MindRoom's background prefetch under it. */
function MessageSettings() {
  const { t } = useTranslation();
  return (
    <Section
      title={t('settings.general.messages.sectionTitle')}
      footer={<MindroomGeneralMessageSettings className={SequenceCardStyle} />}
    >
      <MessageDisplayTiles />
      <SwitchTile
        setting="hideMembershipEvents"
        title={t('settings.general.messages.hideMembershipChange')}
      />
      <SwitchTile
        setting="hideNickAvatarEvents"
        title={t('settings.general.messages.hideProfileChange')}
      />
      <SwitchTile
        setting="mediaAutoLoad"
        inverted
        title={t('settings.general.messages.disableMediaAutoLoad')}
      />
      <SwitchTile setting="urlPreview" title={t('settings.general.messages.urlPreview')} />
      <SwitchTile
        setting="encUrlPreview"
        title={t('settings.general.messages.urlPreviewEncrypted')}
      />
      <SwitchTile
        setting="showHiddenEvents"
        title={t('settings.general.messages.showHiddenEvents')}
      />
    </Section>
  );
}

/**
 * The order of settings.png: MindRoom's interface, computer and connection groups, then the
 * language, appearance, date and time, editor and message groups.
 */
export function General({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame title={t('settings.nav.general')} requestClose={requestClose}>
      <MindroomInterfaceSettings className={SequenceCardStyle} />
      <LanguageSettings />
      <AppearanceSettings />
      <DateTimeSettings />
      <EditorSettings />
      <MessageSettings />
    </SettingsPageFrame>
  );
}
